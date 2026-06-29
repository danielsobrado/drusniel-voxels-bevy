import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  attribute,
  clamp,
  dot,
  float,
  fract,
  frontFacing,
  max,
  mix,
  normalize,
  screenCoordinate,
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
  (material as unknown as { maskNode: TslNode }).maskNode = treeImpostorNodeDitherMask();
  material.alphaTest = settings.impostors.alphaTest;
  material.side = THREE.DoubleSide;
  material.transparent = false;
  material.depthWrite = true;
  return material;
}

export function createTreeImpostorBlendNodeMaterial(
  settings: TreeSettings,
  atlas: TreeImpostorAtlas,
): THREE.Material {
  const weights: TslNode = attribute("treeImpostorBlendWeights", "vec4");
  const sample0 = sampleTreeImpostorNode(atlas, attribute("treeImpostorUvRect0", "vec4"));
  const sample1 = sampleTreeImpostorNode(atlas, attribute("treeImpostorUvRect1", "vec4"));
  const sample2 = sampleTreeImpostorNode(atlas, attribute("treeImpostorUvRect2", "vec4"));
  const sample3 = sampleTreeImpostorNode(atlas, attribute("treeImpostorUvRect3", "vec4"));
  const albedo = sample0.albedo.mul(weights.x)
    .add(sample1.albedo.mul(weights.y))
    .add(sample2.albedo.mul(weights.z))
    .add(sample3.albedo.mul(weights.w));
  const coverage = sample0.coverage.mul(weights.x)
    .add(sample1.coverage.mul(weights.y))
    .add(sample2.coverage.mul(weights.z))
    .add(sample3.coverage.mul(weights.w));
  const normalSample = sample0.normal && sample1.normal && sample2.normal && sample3.normal
    ? blendTreeImpostorNormal(sample0.normal, sample1.normal, sample2.normal, sample3.normal, weights)
    : null;
  const material = new MeshBasicNodeMaterial();
  material.colorNode = normalSample ? relightTreeImpostorNode(albedo, normalSample) : albedo;
  (material as unknown as { opacityNode: TslNode }).opacityNode = coverage;
  (material as unknown as { maskNode: TslNode }).maskNode = treeImpostorNodeDitherMask();
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

export function createTreeImpostorBlendMaterial(
  settings: TreeSettings,
  atlas: TreeImpostorAtlas,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: `tree-impostor-blend-${atlas.species}`,
    uniforms: {
      map: { value: atlas.albedo ?? atlas.texture },
      normalDepthMap: { value: atlas.normalDepth ?? null },
      hasNormalDepthMap: { value: atlas.normalDepth ? 1 : 0 },
      alphaTest: { value: settings.impostors.alphaTest },
    },
    vertexShader: TREE_IMPOSTOR_BLEND_VERTEX_SHADER,
    fragmentShader: TREE_IMPOSTOR_BLEND_FRAGMENT_SHADER,
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

function sampleTreeImpostorNode(atlas: TreeImpostorAtlas, uvRect: TslNode): { albedo: TslNode; coverage: TslNode; normal: TslNode | null } {
  const atlasUv: TslNode = uvRect.xy.add(uv().mul(uvRect.zw.sub(uvRect.xy)));
  const sample: TslNode = texture(atlas.albedo ?? atlas.texture, atlasUv);
  return {
    albedo: sample.xyz.mul(sample.xyz),
    coverage: sample.w,
    normal: atlas.normalDepth ? texture(atlas.normalDepth, atlasUv) : null,
  };
}

function blendTreeImpostorNormal(n0: TslNode, n1: TslNode, n2: TslNode, n3: TslNode, weights: TslNode): TslNode {
  const blended = n0.xyz.mul(weights.x)
    .add(n1.xyz.mul(weights.y))
    .add(n2.xyz.mul(weights.z))
    .add(n3.xyz.mul(weights.w));
  return { xyz: blended } as TslNode;
}

function treeImpostorNodeDitherMask(): TslNode {
  const lodFade: TslNode = attribute("treeLodFade", "float");
  const ign: TslNode = fract(
    fract(screenCoordinate.x.mul(0.06711056).add(screenCoordinate.y.mul(0.00583715))).mul(52.9829189),
  );
  return ign.lessThan(lodFade);
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
attribute float treeLodFade;
varying vec2 vTreeImpostorUv;
varying float vTreeImpostorLodFade;

void main() {
  vec2 atlasScale = treeImpostorUvRect.zw - treeImpostorUvRect.xy;
  vTreeImpostorUv = treeImpostorUvRect.xy + uv * atlasScale;
  vTreeImpostorLodFade = treeLodFade;
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
varying float vTreeImpostorLodFade;

float treeImpostorDither(vec2 fragCoord) {
  return fract(52.9829189 * fract(dot(fragCoord, vec2(0.06711056, 0.00583715))));
}

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
  if (treeImpostorDither(gl_FragCoord.xy) >= vTreeImpostorLodFade) discard;
  vec3 albedo = color.rgb * color.rgb;
  if (hasNormalDepthMap > 0.5) {
    vec4 normalDepth = texture2D(normalDepthMap, vTreeImpostorUv);
    albedo = treeImpostorRelight(albedo, normalDepth.rgb);
  }
  gl_FragColor = vec4(albedo, color.a);
}
`;

export const TREE_IMPOSTOR_BLEND_VERTEX_SHADER = `
attribute vec4 treeImpostorUvRect0;
attribute vec4 treeImpostorUvRect1;
attribute vec4 treeImpostorUvRect2;
attribute vec4 treeImpostorUvRect3;
attribute vec4 treeImpostorBlendWeights;
attribute float treeLodFade;
varying vec2 vTreeImpostorUv0;
varying vec2 vTreeImpostorUv1;
varying vec2 vTreeImpostorUv2;
varying vec2 vTreeImpostorUv3;
varying vec4 vTreeImpostorBlendWeights;
varying float vTreeImpostorLodFade;

vec2 treeImpostorAtlasUv(vec4 rect) {
  return rect.xy + uv * (rect.zw - rect.xy);
}

void main() {
  vTreeImpostorUv0 = treeImpostorAtlasUv(treeImpostorUvRect0);
  vTreeImpostorUv1 = treeImpostorAtlasUv(treeImpostorUvRect1);
  vTreeImpostorUv2 = treeImpostorAtlasUv(treeImpostorUvRect2);
  vTreeImpostorUv3 = treeImpostorAtlasUv(treeImpostorUvRect3);
  vTreeImpostorBlendWeights = treeImpostorBlendWeights;
  vTreeImpostorLodFade = treeLodFade;
  vec4 transformed = vec4(position, 1.0);
#ifdef USE_INSTANCING
  transformed = instanceMatrix * transformed;
#endif
  gl_Position = projectionMatrix * modelViewMatrix * transformed;
}
`;

export const TREE_IMPOSTOR_BLEND_FRAGMENT_SHADER = `
uniform sampler2D map;
uniform sampler2D normalDepthMap;
uniform float hasNormalDepthMap;
uniform float alphaTest;
varying vec2 vTreeImpostorUv0;
varying vec2 vTreeImpostorUv1;
varying vec2 vTreeImpostorUv2;
varying vec2 vTreeImpostorUv3;
varying vec4 vTreeImpostorBlendWeights;
varying float vTreeImpostorLodFade;

float treeImpostorDither(vec2 fragCoord) {
  return fract(52.9829189 * fract(dot(fragCoord, vec2(0.06711056, 0.00583715))));
}

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
  vec4 c0 = texture2D(map, vTreeImpostorUv0);
  vec4 c1 = texture2D(map, vTreeImpostorUv1);
  vec4 c2 = texture2D(map, vTreeImpostorUv2);
  vec4 c3 = texture2D(map, vTreeImpostorUv3);
  vec4 color = c0 * vTreeImpostorBlendWeights.x + c1 * vTreeImpostorBlendWeights.y + c2 * vTreeImpostorBlendWeights.z + c3 * vTreeImpostorBlendWeights.w;
  if (color.a < alphaTest) discard;
  if (treeImpostorDither(gl_FragCoord.xy) >= vTreeImpostorLodFade) discard;
  vec3 albedo = color.rgb * color.rgb;
  if (hasNormalDepthMap > 0.5) {
    vec3 n0 = texture2D(normalDepthMap, vTreeImpostorUv0).rgb;
    vec3 n1 = texture2D(normalDepthMap, vTreeImpostorUv1).rgb;
    vec3 n2 = texture2D(normalDepthMap, vTreeImpostorUv2).rgb;
    vec3 n3 = texture2D(normalDepthMap, vTreeImpostorUv3).rgb;
    vec3 normal = n0 * vTreeImpostorBlendWeights.x + n1 * vTreeImpostorBlendWeights.y + n2 * vTreeImpostorBlendWeights.z + n3 * vTreeImpostorBlendWeights.w;
    albedo = treeImpostorRelight(albedo, normal);
  }
  gl_FragColor = vec4(albedo, color.a);
}
`;
