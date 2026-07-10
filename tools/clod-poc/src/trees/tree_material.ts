import * as THREE from "three";
import type { PrepassNodes } from "../rendering/veg_prepass.js";
import { TREE_LODS, type TreeLod, type TreeSettings } from "./tree_config.js";
import {
  createTreeFoliageAtlas,
  TREE_FOLIAGE_ATLAS_COLUMNS,
  TREE_FOLIAGE_ATLAS_ROWS,
  type TreeFoliageAtlas,
} from "./tree_alpha_mask.js";
import type { EnvironmentLighting } from "../environment/environment.js";
import {
  createForestLightingUniforms,
  injectForestLightingFragmentShader,
  injectForestLightingVertexShader,
  updateForestLightingUniforms,
  type ForestLightingMaterialState,
  type ForestLightingUniforms,
} from "../forest_lighting/index.js";
import {
  materialChurnDiagnostics,
  setMaterialNeedsUpdate,
  setPipelineSensitiveMaterialProperty,
} from "../rendering/material_churn/material_churn_diagnostics.js";
import {
  trackedMeshBasicMaterial,
  trackedMeshStandardMaterial,
} from "../rendering/material_churn/tracked_material_factory.js";

export interface TreeMaterialHandle {
  regularMaterial: THREE.Material;
  debugMaterials: Record<TreeLod, THREE.Material>;
  setTime(timeSeconds: number): void;
  setFadeCenter?(x: number, z: number): void;
  prepassNodesFor?(lod: TreeLod): PrepassNodes | undefined;
  updateSettings(settings: TreeSettings): void;
  dispose(): void;
  updateLighting?(lighting: EnvironmentLighting): void;
  updateForestLighting?(state: ForestLightingMaterialState | null): void;
}

const LOD_COLORS: Record<TreeLod, number> = {
  near: 0x2e7d32,
  mid: 0xd98032,
  far: 0x3a6ea5,
  impostor: 0x7755aa,
};

interface TreeWindUniforms {
  uTreeTime: { value: number };
  uTreeWindDirection: { value: THREE.Vector2 };
  uTreeWindStrength: { value: number };
  uTreeWindSpeed: { value: number };
  uTreeGustStrength: { value: number };
  uTreeTrunkSwayStrength: { value: number };
  uTreeLeafFlutterStrength: { value: number };
  uTreeVariantSeed: { value: number };
}

export function createTreeMaterialHandle(
  settings: TreeSettings,
  providedAtlas?: TreeFoliageAtlas,
): TreeMaterialHandle {
  const uniforms = createTreeWindUniforms(settings);
  const forestUniforms = createForestLightingUniforms();
  const foliageAtlas = providedAtlas ?? createTreeFoliageAtlas(settings);
  const ownsAtlas = providedAtlas === undefined;
  const regularMaterial = trackedMeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
  }, "tree-regular-material");
  applyFoliageMaterialSettings(regularMaterial, foliageAtlas);
  attachTreeShader(regularMaterial, uniforms, forestUniforms);

  const debugMaterials = {} as Record<TreeLod, THREE.MeshBasicMaterial>;
  for (const lod of TREE_LODS) {
    const material = trackedMeshBasicMaterial({
      color: LOD_COLORS[lod],
      side: THREE.DoubleSide,
      transparent: false,
      map: foliageAtlas.texture,
    }, `tree-debug-material:${lod}`);
    attachTreeShader(material, uniforms, forestUniforms);
    debugMaterials[lod] = material;
  }

  return {
    regularMaterial,
    debugMaterials,
    setTime(timeSeconds: number) {
      uniforms.uTreeTime.value = timeSeconds;
    },
    updateSettings(nextSettings: TreeSettings) {
      updateTreeWindUniforms(uniforms, nextSettings);
      applyFoliageMaterialSettings(regularMaterial, foliageAtlas);
    },
    updateForestLighting(state) {
      updateForestLightingUniforms(forestUniforms, state, "tree");
    },
    dispose() {
      if (ownsAtlas) foliageAtlas.dispose();
      regularMaterial.dispose();
      for (const material of Object.values(debugMaterials)) material.dispose();
    },
  };
}

export function injectTreeWindShader(vertexShader: string): string {
  return injectTreeFoliageVertexShader(vertexShader)
    .replace(
      "#include <common>",
      `#include <common>
attribute vec2 treeWind;
attribute vec2 treeWorldXZ;
attribute float treeLodFade;
attribute float treeLodDitherRole;
attribute float treeVariant;
varying float vTreeLodFade;
varying float vTreeLodDitherRole;
uniform float uTreeTime;
uniform vec2 uTreeWindDirection;
uniform float uTreeWindStrength;
uniform float uTreeWindSpeed;
uniform float uTreeGustStrength;
uniform float uTreeTrunkSwayStrength;
uniform float uTreeLeafFlutterStrength;
uniform float uTreeVariantSeed;

float treeWindHash(vec2 value) {
  return fract(sin(dot(value, vec2(127.1, 311.7))) * 43758.5453123);
}

float treeSelectedVariant(vec2 worldXZ) {
  vec2 seeded = worldXZ + vec2(uTreeVariantSeed * 0.013 + 1103.0, uTreeVariantSeed * 0.037 - 1103.0);
  return floor(treeWindHash(seeded) * 4.0);
}`,
    )
    .replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
vTreeLodFade = treeLodFade;
vTreeLodDitherRole = treeLodDitherRole;
#ifdef USE_INSTANCING
vec2 treeInstanceWorldXZ = treeWorldXZ;
#else
vec2 treeInstanceWorldXZ = vec2(0.0);
#endif
float treeVariantKeep = 1.0 - step(0.5, abs(treeVariant - treeSelectedVariant(treeInstanceWorldXZ)));
transformed *= treeVariantKeep;
float treePhase = treeWindHash(treeInstanceWorldXZ);
float treeShapePhase = treeWindHash(treeInstanceWorldXZ + vec2(23.17, 91.71));
float treeHeightMask = smoothstep(0.0, 14.0, position.y);
float treeShape = (treeShapePhase - 0.5) * treeHeightMask;
transformed.xz += normalize(transformed.xz + vec2(0.001)) * treeShape * 0.34 * treeVariantKeep;
transformed.y *= 1.0 + treeShape * 0.055 * treeVariantKeep;
float treeTime = uTreeTime * uTreeWindSpeed;
float treeWave = sin(treeTime + treePhase * 6.2831853 + dot(treeInstanceWorldXZ, uTreeWindDirection) * 0.035);
float treeGust = sin(treeTime * 0.37 + treePhase * 12.9898) * uTreeGustStrength;
float treeSway = (treeWave * uTreeWindStrength + treeGust) * treeWind.x * uTreeTrunkSwayStrength;
float treeFlutter = sin(treeTime * 7.0 + treePhase * 19.19 + position.y * 2.3) *
  uTreeWindStrength * uTreeLeafFlutterStrength * treeWind.y;
transformed.xz += uTreeWindDirection * (treeSway + treeFlutter) * treeVariantKeep;`,
    );
}

export function injectTreeFoliageVertexShader(vertexShader: string): string {
  return vertexShader.replace(
    "#include <common>",
    `#include <common>
attribute float treeFoliageMask;
attribute float treeFoliageCard;
attribute float treeSpeciesIndex;
varying float vTreeFoliageMask;
varying float vTreeFoliageCard;
varying float vTreeSpeciesIndex;`,
  ).replace(
    "#include <begin_vertex>",
    `#include <begin_vertex>
vTreeFoliageMask = treeFoliageMask;
vTreeFoliageCard = treeFoliageCard;
vTreeSpeciesIndex = treeSpeciesIndex;`,
  );
}

export function injectTreeFoliageFragmentShader(fragmentShader: string): string {
  return fragmentShader.replace(
    "#include <common>",
    `#include <common>
varying float vTreeFoliageMask;
varying float vTreeFoliageCard;
varying float vTreeSpeciesIndex;`,
  ).replace(
    "#include <map_fragment>",
    `#ifdef USE_MAP
vec2 treeLocalUv = clamp(vMapUv, vec2(0.0), vec2(0.9999));
vec2 treeScaledUv = treeLocalUv * 2.0;
vec2 treeTileXY = floor(treeScaledUv);
float treeTile = treeTileXY.x + treeTileXY.y * 2.0;
vec2 treeWithinTile = fract(treeScaledUv);
float treeSpeciesRow = clamp(floor(vTreeSpeciesIndex + 0.5), 0.0, ${TREE_FOLIAGE_ATLAS_ROWS - 1}.0);
vec2 treeAtlasUv = vec2(
  (treeTile + treeWithinTile.x) / ${TREE_FOLIAGE_ATLAS_COLUMNS}.0,
  (treeSpeciesRow + treeWithinTile.y) / ${TREE_FOLIAGE_ATLAS_ROWS}.0
);
vec4 treeAtlasSample = texture2D(map, treeAtlasUv);
float treeCard = clamp(vTreeFoliageCard, 0.0, 1.0);
if (treeCard > 0.5 && treeAtlasSample.a < 0.32) discard;
diffuseColor.rgb *= mix(vec3(1.0), treeAtlasSample.rgb * 1.08, treeCard);
#endif`,
  );
}

export function injectTreeLodFadeFragmentShader(fragmentShader: string): string {
  return fragmentShader.replace(
    "#include <common>",
    `#include <common>
varying float vTreeLodFade;
varying float vTreeLodDitherRole;`,
  ).replace(
    "#include <clipping_planes_fragment>",
    `#include <clipping_planes_fragment>
float treeLodIgn = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
if (vTreeLodDitherRole < 0.5) {
  if (treeLodIgn >= vTreeLodFade) discard;
} else {
  if (treeLodIgn < 1.0 - vTreeLodFade) discard;
}`,
  );
}

function attachTreeShader(
  material: THREE.Material,
  uniforms: TreeWindUniforms,
  forestUniforms: ForestLightingUniforms,
): void {
  materialChurnDiagnostics.trackPipelineSensitiveMutation(material, "onBeforeCompile", null, "tree-shader", "tree-shader-attach");
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, forestUniforms);
    shader.vertexShader = injectForestLightingVertexShader(injectTreeWindShader(shader.vertexShader), "treeWorldXZ", false);
    shader.fragmentShader = injectTreeLodFadeFragmentShader(
      injectForestLightingFragmentShader(injectTreeFoliageFragmentShader(shader.fragmentShader)),
    );
  };
}

function applyFoliageMaterialSettings(
  material: THREE.MeshStandardMaterial,
  atlas: TreeFoliageAtlas,
): void {
  let changed = false;
  changed = setPipelineSensitiveMaterialProperty(materialChurnDiagnostics, material, "side", THREE.DoubleSide, "tree-foliage-settings") || changed;
  changed = setPipelineSensitiveMaterialProperty(materialChurnDiagnostics, material, "transparent", false, "tree-foliage-settings") || changed;
  changed = setPipelineSensitiveMaterialProperty(materialChurnDiagnostics, material, "depthWrite", true, "tree-foliage-settings") || changed;
  changed = setPipelineSensitiveMaterialProperty(materialChurnDiagnostics, material, "alphaTest", 0, "tree-foliage-settings") || changed;
  changed = setPipelineSensitiveMaterialProperty(materialChurnDiagnostics, material, "map", atlas.texture, "tree-foliage-settings") || changed;
  if (changed) setMaterialNeedsUpdate(materialChurnDiagnostics, material, "tree-foliage-settings");
}

function createTreeWindUniforms(settings: TreeSettings): TreeWindUniforms {
  const uniforms: TreeWindUniforms = {
    uTreeTime: { value: 0 },
    uTreeWindDirection: { value: new THREE.Vector2(1, 0) },
    uTreeWindStrength: { value: 0 },
    uTreeWindSpeed: { value: 0 },
    uTreeGustStrength: { value: 0 },
    uTreeTrunkSwayStrength: { value: 0 },
    uTreeLeafFlutterStrength: { value: 0 },
    uTreeVariantSeed: { value: settings.seed },
  };
  updateTreeWindUniforms(uniforms, settings);
  return uniforms;
}

function updateTreeWindUniforms(uniforms: TreeWindUniforms, settings: TreeSettings): void {
  const wind = settings.wind;
  uniforms.uTreeWindDirection.value.set(wind.direction[0], wind.direction[1]);
  if (uniforms.uTreeWindDirection.value.lengthSq() <= 1e-8) uniforms.uTreeWindDirection.value.set(1, 0);
  else uniforms.uTreeWindDirection.value.normalize();

  const enabled = wind.enabled ? 1 : 0;
  uniforms.uTreeWindStrength.value = wind.strength * enabled;
  uniforms.uTreeWindSpeed.value = wind.speed;
  uniforms.uTreeGustStrength.value = wind.gustStrength * enabled;
  uniforms.uTreeTrunkSwayStrength.value = wind.trunkSwayStrength * enabled;
  uniforms.uTreeLeafFlutterStrength.value = wind.leafFlutterStrength * enabled;
  uniforms.uTreeVariantSeed.value = settings.seed;
}
