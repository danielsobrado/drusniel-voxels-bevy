import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  attribute,
  clamp,
  dot,
  float,
  frontFacing,
  max,
  mix,
  normalize,
  texture,
  uniform,
  uv,
  vec3,
} from "three/tsl";
import type { TreeSettings } from "./tree_config.js";
import type { TreeImpostorAtlas } from "./tree_impostor_baker.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

const TREE_IMPOSTOR_SUN_DIRECTION = new THREE.Vector3(0.4, 0.85, 0.3).normalize();
const TREE_IMPOSTOR_SUN_COLOR = new THREE.Vector3(1.0, 0.96, 0.88);
const TREE_IMPOSTOR_SKY_COLOR = new THREE.Vector3(0.42, 0.48, 0.58);
const TREE_IMPOSTOR_GROUND_COLOR = new THREE.Vector3(0.18, 0.16, 0.13);
const TREE_IMPOSTOR_AMBIENT = 0.25;

/** WebGPU node-material impostor path. The baker stores sqrt-encoded albedo. */
export function createTreeImpostorNodeMaterial(
  settings: TreeSettings,
  atlas: TreeImpostorAtlas,
): THREE.Material {
  const uvRect: TslNode = attribute("treeImpostorUvRect", "vec4");
  const atlasUv: TslNode = uvRect.xy.add(uv().mul(uvRect.zw.sub(uvRect.xy)));
  const sample: TslNode = texture(atlas.albedo ?? atlas.texture, atlasUv);
  const albedo: TslNode = sample.xyz.mul(sample.xyz);
  const normalSample: TslNode | null = atlas.normalDepth ? texture(atlas.normalDepth, atlasUv) : null;
  const material = new MeshBasicNodeMaterial();
  material.colorNode = normalSample ? relightTreeImpostorNode(albedo, normalSample) : albedo;
  (material as unknown as { opacityNode: TslNode }).opacityNode = sample.w;
  material.alphaTest = settings.impostors.alphaTest;
  material.side = THREE.DoubleSide;
  material.transparent = false;
  material.depthWrite = true;
  return material;
}

export function createTreeImpostorMaterial(
  settings: TreeSettings,
  atlas: TreeImpostorAtlas,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: `tree-impostor-${atlas.species}`,
    uniforms: {
      map: { value: atlas.albedo ?? atlas.texture },
      normalDepthMap: { value: atlas.normalDepth ?? null },
      hasNormalDepthMap: { value: atlas.normalDepth ? 1 : 0 },
      alphaTest: { value: settings.impostors.alphaTest },
    },
    vertexShader: TREE_IMPOSTOR_VERTEX_SHADER,
    fragmentShader: TREE_IMPOSTOR_FRAGMENT_SHADER,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
  });
}

export function updateTreeImpostorMaterialSettings(material: THREE.Material, settings: TreeSettings): void {
  if (material instanceof THREE.ShaderMaterial && "alphaTest" in material.uniforms) {
    material.uniforms.alphaTest.value = settings.impostors.alphaTest;
  } else {
    material.alphaTest = settings.impostors.alphaTest;
  }
  material.side = THREE.DoubleSide;
  material.transparent = false;
  material.depthWrite = true;
  material.needsUpdate = true;
}

function relightTreeImpostorNode(albedo: TslNode, normalSample: TslNode): TslNode {
  const rawNormal: TslNode = normalSample.xyz.mul(2).sub(1);
  const n0: TslNode = normalize(rawNormal);
  const n: TslNode = frontFacing.select(n0, n0.negate());
  const sunDirection = uniform(TREE_IMPOSTOR_SUN_DIRECTION.clone());
  const sunColor = uniform(TREE_IMPOSTOR_SUN_COLOR.clone());
  const skyColor = uniform(TREE_IMPOSTOR_SKY_COLOR.clone());
  const groundColor = uniform(TREE_IMPOSTOR_GROUND_COLOR.clone());
  const sun: TslNode = max(dot(n, sunDirection), 0.0);
  const sky: TslNode = clamp(n.y.mul(0.5).add(0.5), 0.0, 1.0);
  const hemi: TslNode = mix(groundColor, skyColor, sky);
  return albedo.mul(float(TREE_IMPOSTOR_AMBIENT)).add(albedo.mul(hemi.add(sunColor.mul(sun))));
}

export const TREE_IMPOSTOR_VERTEX_SHADER = `
attribute vec4 treeImpostorUvRect;
varying vec2 vTreeImpostorUv;

void main() {
  vec2 atlasScale = treeImpostorUvRect.zw - treeImpostorUvRect.xy;
  vTreeImpostorUv = treeImpostorUvRect.xy + uv * atlasScale;
  vec4 transformed = vec4(position, 1.0);
#ifdef USE_INSTANCING
  transformed = instanceMatrix * transformed;
#endif
  gl_Position = projectionMatrix * modelViewMatrix * transformed;
}
`;

export const TREE_IMPOSTOR_FRAGMENT_SHADER = `
uniform sampler2D map;
uniform sampler2D normalDepthMap;
uniform float hasNormalDepthMap;
uniform float alphaTest;
varying vec2 vTreeImpostorUv;

vec3 treeImpostorRelight(vec3 albedo, vec3 packedNormal) {
  vec3 n = normalize(packedNormal * 2.0 - 1.0);
  vec3 sunDir = normalize(vec3(0.4, 0.85, 0.3));
  vec3 sunColor = vec3(1.0, 0.96, 0.88);
  vec3 skyColor = vec3(0.42, 0.48, 0.58);
  vec3 groundColor = vec3(0.18, 0.16, 0.13);
  float sun = max(dot(n, sunDir), 0.0);
  float sky = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 hemi = mix(groundColor, skyColor, sky);
  return albedo * 0.25 + albedo * (hemi + sunColor * sun);
}

void main() {
  vec4 color = texture2D(map, vTreeImpostorUv);
  if (color.a < alphaTest) discard;
  vec3 albedo = color.rgb * color.rgb;
  if (hasNormalDepthMap > 0.5) {
    vec4 normalDepth = texture2D(normalDepthMap, vTreeImpostorUv);
    albedo = treeImpostorRelight(albedo, normalDepth.rgb);
  }
  gl_FragColor = vec4(albedo, color.a);
}
`;
