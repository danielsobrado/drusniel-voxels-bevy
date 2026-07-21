import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  attribute,
  cameraPosition,
  clamp,
  dot,
  float,
  floor,
  fract,
  frontFacing,
  max,
  mix,
  normalize,
  positionWorld,
  sqrt,
  texture,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import {
  TREE_FOLIAGE_ATLAS_COLUMNS,
  TREE_FOLIAGE_ATLAS_ROWS,
  type TreeFoliageAtlas,
} from "./tree_alpha_mask.js";
import type { TreeSettings } from "./tree_config.js";
import {
  injectTreeFoliageFragmentShader,
  injectTreeFoliageVertexShader,
} from "./tree_material.js";
import { barkTrunkAlbedo, sharedBarkTexture } from "./tree_node_bark_texture.js";
import { materialChurnDiagnostics } from "../rendering/material_churn/material_churn_diagnostics.js";
import {
  trackCreatedMaterial,
  trackedMeshBasicMaterial,
  trackedShaderMaterial,
} from "../rendering/material_churn/tracked_material_factory.js";
import { TREE_IMPOSTOR_DEPTH_EXTENT_DIVISOR } from "./tree_impostor_depth_contract.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

const TREE_IMPOSTOR_CARD_ALPHA_THRESHOLD = 0.32;

export function createTreeImpostorBakeMaterial(
  sourceMaterial: THREE.Material,
  settings: TreeSettings,
  foliageAtlas: TreeFoliageAtlas | undefined,
  webgpu: boolean,
): THREE.Material {
  if (webgpu) {
    const material = trackCreatedMaterial(
      new MeshBasicNodeMaterial(),
      "tree-impostor-bake-albedo-node",
    );
    material.name = "tree-impostor-albedo-bake";
    const vertexAlbedo: TslNode = clamp(attribute("color", "vec3"), vec3(0), vec3(1));
    const foliageMask: TslNode = clamp(attribute("treeFoliageMask", "float"), 0, 1);
    const barkAlbedo: TslNode = barkTrunkAlbedo(vertexAlbedo, sharedBarkTexture(settings.seed));
    let albedo: TslNode = mix(barkAlbedo, vertexAlbedo, foliageMask);
    if (foliageAtlas) {
      const foliage = createFoliageCaptureNodes(foliageAtlas);
      albedo = mix(albedo, albedo.mul(foliage.cardShade), foliage.cardTag);
      (material as unknown as { maskNode: TslNode }).maskNode = foliage.keep;
    }
    const capturedAlbedo: TslNode = clamp(albedo, vec3(0), vec3(1));
    material.colorNode = sqrt(capturedAlbedo);
    material.alphaTest = 0;
    material.side = THREE.DoubleSide;
    material.transparent = false;
    material.depthWrite = true;
    return material;
  }

  const map = sourceMaterial instanceof THREE.MeshStandardMaterial || sourceMaterial instanceof THREE.MeshBasicMaterial
    ? sourceMaterial.map
    : null;
  const material = trackedMeshBasicMaterial({
    vertexColors: true,
    map,
    alphaTest: settings.foliage.enabled ? settings.foliage.alphaTest : 0,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
  }, "tree-impostor-bake-albedo");
  materialChurnDiagnostics.trackPipelineSensitiveMutation(
    material,
    "onBeforeCompile",
    null,
    "tree-impostor-bake",
    "tree-impostor-bake-shader",
  );
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = injectTreeFoliageVertexShader(shader.vertexShader);
    shader.fragmentShader = injectTreeFoliageFragmentShader(shader.fragmentShader);
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      "diffuseColor.rgb = sqrt(max(diffuseColor.rgb, vec3(0.0)));\n#include <opaque_fragment>",
    );
  };
  return material;
}

export function createTreeImpostorNormalDepthBakeMaterial(
  near: number,
  far: number,
  foliageAtlas: TreeFoliageAtlas | undefined,
  webgpu: boolean,
): THREE.Material {
  if (webgpu) {
    const material = trackCreatedMaterial(
      new MeshBasicNodeMaterial(),
      "tree-impostor-bake-normal-depth-node",
    );
    const depthExtent = float(Math.max((far - near) / TREE_IMPOSTOR_DEPTH_EXTENT_DIVISOR, 0.0001));
    const captureDirection: TslNode = normalize(cameraPosition);
    const relativeDepth: TslNode = dot(positionWorld, captureDirection);
    const encodedDepth: TslNode = clamp(relativeDepth.div(depthExtent).mul(0.5).add(0.5), 0, 1);
    material.name = "tree-impostor-normal-depth-bake";
    const localNormal: TslNode = normalize(attribute("normal", "vec3"));
    const facingNormal: TslNode = (frontFacing as TslNode).select(localNormal, localNormal.negate());
    material.colorNode = facingNormal.mul(0.5).add(0.5);
    material.opacityNode = encodedDepth;
    if (foliageAtlas) {
      (material as unknown as { maskNode: TslNode }).maskNode = createFoliageCaptureNodes(foliageAtlas).keep;
    }
    material.side = THREE.DoubleSide;
    material.transparent = false;
    material.depthWrite = true;
    return material;
  }

  return trackedShaderMaterial({
    name: "tree-impostor-normal-depth-bake",
    uniforms: {
      near: { value: near },
      far: { value: far },
      foliageAtlas: { value: foliageAtlas?.texture ?? null },
      hasFoliageAtlas: { value: foliageAtlas ? 1 : 0 },
    },
    vertexShader: TREE_IMPOSTOR_NORMAL_DEPTH_VERTEX_SHADER,
    fragmentShader: TREE_IMPOSTOR_NORMAL_DEPTH_FRAGMENT_SHADER,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
  }, "tree-impostor-bake-normal-depth");
}

function createFoliageCaptureNodes(atlas: TreeFoliageAtlas): {
  cardTag: TslNode;
  cardShade: TslNode;
  keep: TslNode;
} {
  const cardTag: TslNode = clamp(attribute("treeFoliageCard", "float"), 0, 1);
  const treeWind: TslNode = attribute("treeWind", "vec3");
  const speciesIndex: TslNode = clamp(
    floor(treeWind.z.add(0.5)),
    0,
    TREE_FOLIAGE_ATLAS_ROWS - 1,
  );
  const localUv: TslNode = clamp(uv(), vec2(0), vec2(0.9999));
  const scaled: TslNode = localUv.mul(2);
  const tileX: TslNode = floor(scaled.x);
  const tileY: TslNode = floor(scaled.y);
  const tile: TslNode = tileX.add(tileY.mul(2));
  const within: TslNode = fract(scaled);
  const atlasUv: TslNode = vec2(
    tile.add(within.x).div(TREE_FOLIAGE_ATLAS_COLUMNS),
    speciesIndex.add(within.y).div(TREE_FOLIAGE_ATLAS_ROWS),
  );
  const sampled: TslNode = texture(atlas.texture, atlasUv);
  const keep: TslNode = mix(float(1), sampled.w, cardTag)
    .greaterThan(TREE_IMPOSTOR_CARD_ALPHA_THRESHOLD);
  const atlasValue: TslNode = max(max(sampled.x, sampled.y), sampled.z);
  const shadeValue: TslNode = mix(0.72, 1.08, clamp(atlasValue.mul(4), 0, 1));
  return {
    cardTag,
    cardShade: mix(vec3(1), vec3(shadeValue), cardTag),
    keep,
  };
}

export const TREE_IMPOSTOR_NORMAL_DEPTH_VERTEX_SHADER = `
uniform float near;
uniform float far;
attribute float treeFoliageCard;
attribute vec3 treeWind;
varying vec2 vTreeImpostorUv;
varying float vTreeImpostorFoliageCard;
varying float vTreeImpostorSpeciesIndex;
varying vec3 vTreeImpostorLocalNormal;
varying float vTreeImpostorRelativeDepth;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vec4 mvPosition = viewMatrix * worldPosition;
  vec3 captureDirection = normalize(cameraPosition);
  float depthExtent = max((far - near) / ${TREE_IMPOSTOR_DEPTH_EXTENT_DIVISOR.toFixed(1)}, 0.0001);
  float relativeDepth = dot(worldPosition.xyz, captureDirection);
  vTreeImpostorUv = uv;
  vTreeImpostorFoliageCard = treeFoliageCard;
  vTreeImpostorSpeciesIndex = treeWind.z;
  vTreeImpostorLocalNormal = normalize(normal);
  vTreeImpostorRelativeDepth = clamp(relativeDepth / depthExtent * 0.5 + 0.5, 0.0, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

export const TREE_IMPOSTOR_NORMAL_DEPTH_FRAGMENT_SHADER = `
uniform sampler2D foliageAtlas;
uniform float hasFoliageAtlas;
varying vec2 vTreeImpostorUv;
varying float vTreeImpostorFoliageCard;
varying float vTreeImpostorSpeciesIndex;
varying vec3 vTreeImpostorLocalNormal;
varying float vTreeImpostorRelativeDepth;

void main() {
  if (hasFoliageAtlas > 0.5 && vTreeImpostorFoliageCard > 0.5) {
    vec2 localUv = clamp(vTreeImpostorUv, vec2(0.0), vec2(0.9999));
    vec2 scaledUv = localUv * 2.0;
    vec2 tileXY = floor(scaledUv);
    float tile = tileXY.x + tileXY.y * 2.0;
    vec2 withinTile = fract(scaledUv);
    float speciesRow = clamp(floor(vTreeImpostorSpeciesIndex + 0.5), 0.0, ${TREE_FOLIAGE_ATLAS_ROWS - 1}.0);
    vec2 atlasUv = vec2(
      (tile + withinTile.x) / ${TREE_FOLIAGE_ATLAS_COLUMNS}.0,
      (speciesRow + withinTile.y) / ${TREE_FOLIAGE_ATLAS_ROWS}.0
    );
    if (texture2D(foliageAtlas, atlasUv).a < ${TREE_IMPOSTOR_CARD_ALPHA_THRESHOLD.toFixed(2)}) discard;
  }
  vec3 facingNormal = normalize(vTreeImpostorLocalNormal);
  if (!gl_FrontFacing) facingNormal = -facingNormal;
  vec3 packedNormal = facingNormal * 0.5 + 0.5;
  gl_FragColor = vec4(packedNormal, vTreeImpostorRelativeDepth);
}
`;
