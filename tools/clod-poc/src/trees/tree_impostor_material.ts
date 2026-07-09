import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  attribute,
  cameraPosition,
  clamp,
  dot,
  float,
  fract,
  frontFacing,
  max,
  mix,
  normalize,
  positionGeometry,
  screenCoordinate,
  texture,
  uniform,
  uv,
  vec3,
} from "three/tsl";
import type { TreeSettings } from "./tree_config.js";
import type { TreeImpostorAtlas } from "./tree_impostor_baker.js";
import { TREE_IMPOSTOR_LOCAL_POSITION_SCALE_ATTRIBUTE_NAME } from "./tree_system_instance_attributes.js";
import {
  materialChurnDiagnostics,
  setMaterialNeedsUpdate,
  setPipelineSensitiveMaterialProperty,
} from "../rendering/material_churn/material_churn_diagnostics.js";
import {
  trackCreatedMaterial,
  trackedShaderMaterial,
} from "../rendering/material_churn/tracked_material_factory.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

const TREE_IMPOSTOR_SUN_DIRECTION = new THREE.Vector3(0.4, 0.85, 0.3).normalize();
const TREE_IMPOSTOR_SUN_COLOR = new THREE.Vector3(1.0, 0.96, 0.88);
const TREE_IMPOSTOR_SKY_COLOR = new THREE.Vector3(0.42, 0.48, 0.58);
const TREE_IMPOSTOR_GROUND_COLOR = new THREE.Vector3(0.18, 0.16, 0.13);
const TREE_IMPOSTOR_AMBIENT = 0.25;
const TREE_IMPOSTOR_LEAF_TRANSMISSION = 0.22;
const TREE_IMPOSTOR_NORMAL_DETAIL_WEIGHT = 0.65;
const TREE_IMPOSTOR_SUN_MAX = 0.85;

export function createTreeImpostorNodeMaterial(
  settings: TreeSettings,
  atlas: TreeImpostorAtlas,
): THREE.Material {
  const uvRect: TslNode = attribute("treeImpostorUvRect", "vec4");
  const atlasUv: TslNode = uvRect.xy.add(uv().mul(uvRect.zw.sub(uvRect.xy)));
  const sample: TslNode = texture(atlas.albedo ?? atlas.texture, atlasUv);
  const albedo: TslNode = sample.xyz.mul(sample.xyz);
  const normalSample: TslNode | null = atlas.normalDepth ? texture(atlas.normalDepth, atlasUv) : null;
  const billboardNormal = treeImpostorNodeBillboardNormal();
  const material = trackCreatedMaterial(new MeshBasicNodeMaterial(), `tree-impostor-node-material:${atlas.species}`);
  material.positionNode = treeImpostorNodeBillboardPosition(billboardNormal);
  material.colorNode = normalSample ? relightTreeImpostorNode(albedo, normalSample, billboardNormal) : albedo;
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
  const billboardNormal = treeImpostorNodeBillboardNormal();
  const material = trackCreatedMaterial(new MeshBasicNodeMaterial(), `tree-impostor-blend-node-material:${atlas.species}`);
  material.positionNode = treeImpostorNodeBillboardPosition(billboardNormal);
  material.colorNode = normalSample ? relightTreeImpostorNode(albedo, normalSample, billboardNormal) : albedo;
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
  return trackedShaderMaterial({
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
  }, `tree-impostor-shader-material:${atlas.species}`);
}

export function createTreeImpostorBlendMaterial(
  settings: TreeSettings,
  atlas: TreeImpostorAtlas,
): THREE.ShaderMaterial {
  return trackedShaderMaterial({
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
  }, `tree-impostor-blend-shader-material:${atlas.species}`);
}

export function updateTreeImpostorMaterialSettings(material: THREE.Material, settings: TreeSettings): void {
  let changed = false;
  if (material instanceof THREE.ShaderMaterial && "alphaTest" in material.uniforms) {
    material.uniforms.alphaTest.value = settings.impostors.alphaTest;
  } else {
    changed = setPipelineSensitiveMaterialProperty(materialChurnDiagnostics, material, "alphaTest", settings.impostors.alphaTest, "tree-impostor-alpha-test") || changed;
  }
  changed = setPipelineSensitiveMaterialProperty(materialChurnDiagnostics, material, "side", THREE.DoubleSide, "tree-impostor-flags") || changed;
  changed = setPipelineSensitiveMaterialProperty(materialChurnDiagnostics, material, "transparent", false, "tree-impostor-flags") || changed;
  changed = setPipelineSensitiveMaterialProperty(materialChurnDiagnostics, material, "depthWrite", true, "tree-impostor-flags") || changed;
  if (changed) setMaterialNeedsUpdate(materialChurnDiagnostics, material, "tree-impostor-flags");
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

function treeImpostorNodeBillboardNormal(): TslNode {
  const worldXZ: TslNode = attribute("treeWorldXZ", "vec2");
  const toCamera: TslNode = vec3(
    cameraPosition.x.sub(worldXZ.x),
    float(0),
    cameraPosition.z.sub(worldXZ.y),
  );
  return dot(toCamera, toCamera)
    .greaterThan(float(0.000001))
    .select(normalize(toCamera), vec3(0, 0, 1));
}

function treeImpostorNodeBillboardPosition(billboardNormal: TslNode): TslNode {
  const localPositionScale: TslNode = attribute(TREE_IMPOSTOR_LOCAL_POSITION_SCALE_ATTRIBUTE_NAME, "vec4");
  const right: TslNode = vec3(billboardNormal.z, float(0), billboardNormal.x.negate());
  return vec3(localPositionScale.x, localPositionScale.y, localPositionScale.z)
    .add(right.mul(positionGeometry.x.mul(localPositionScale.w)))
    .add(vec3(0, positionGeometry.y.mul(localPositionScale.w), 0));
}

function blendTreeImpostorNormal(n0: TslNode, n1: TslNode, n2: TslNode, n3: TslNode, weights: TslNode): TslNode {
  const blended = decodeTreeImpostorPackedNormalNode(n0).mul(weights.x)
    .add(decodeTreeImpostorPackedNormalNode(n1).mul(weights.y))
    .add(decodeTreeImpostorPackedNormalNode(n2).mul(weights.z))
    .add(decodeTreeImpostorPackedNormalNode(n3).mul(weights.w));
  return { xyz: normalize(blended).mul(0.5).add(0.5) } as TslNode;
}

function decodeTreeImpostorPackedNormalNode(sample: TslNode): TslNode {
  return sample.xyz.mul(2).sub(1);
}

function treeImpostorNodeDitherMask(): TslNode {
  const lodFade: TslNode = attribute("treeLodFade", "float");
  const role: TslNode = attribute("treeLodDitherRole", "float");
  const ign: TslNode = fract(
    fract(screenCoordinate.x.mul(0.06711056).add(screenCoordinate.y.mul(0.00583715))).mul(52.9829189),
  );
  const primary: TslNode = ign.lessThan(lodFade);
  const secondary: TslNode = ign.greaterThanEqual(float(1).sub(lodFade));
  return role.greaterThan(0.5).select(secondary, primary);
}

function relightTreeImpostorNode(albedo: TslNode, normalSample: TslNode, billboardNormal: TslNode): TslNode {
  const rawNormal: TslNode = normalSample.xyz.mul(2).sub(1);
  const capturedNormal: TslNode = normalize(rawNormal);
  const n0: TslNode = normalize(mix(billboardNormal, capturedNormal, float(TREE_IMPOSTOR_NORMAL_DETAIL_WEIGHT)));
  const n: TslNode = frontFacing.select(n0, n0.negate());
  const sunDirection = uniform(TREE_IMPOSTOR_SUN_DIRECTION.clone());
  const sunColor = uniform(TREE_IMPOSTOR_SUN_COLOR.clone());
  const skyColor = uniform(TREE_IMPOSTOR_SKY_COLOR.clone());
  const groundColor = uniform(TREE_IMPOSTOR_GROUND_COLOR.clone());
  const sun: TslNode = clamp(max(dot(n, sunDirection), 0.0), 0.0, TREE_IMPOSTOR_SUN_MAX);
  const sky: TslNode = clamp(n.y.mul(0.5).add(0.5), 0.0, 1.0);
  const hemi: TslNode = mix(groundColor, skyColor, sky);
  const direct: TslNode = sunColor.mul(sun);
  const back: TslNode = max(dot(n.negate(), sunDirection), 0.0);
  const transmission: TslNode = albedo.mul(sunColor).mul(back).mul(TREE_IMPOSTOR_LEAF_TRANSMISSION);
  const lit: TslNode = albedo.mul(float(TREE_IMPOSTOR_AMBIENT)).add(albedo.mul(hemi.add(direct))).add(transmission);
  return clamp(lit, 0.0, 1.0);
}

export const TREE_IMPOSTOR_VERTEX_SHADER = `
#define TREE_IMPOSTOR_NORMAL_DETAIL_WEIGHT 0.65
attribute vec4 treeImpostorUvRect;
attribute float treeLodFade;
attribute float treeLodDitherRole;
varying vec2 vTreeImpostorUv;
varying vec3 vTreeImpostorBillboardNormal;
varying float vTreeImpostorLodFade;
varying float vTreeImpostorLodDitherRole;

vec3 treeImpostorBillboardNormal(vec3 origin) {
  vec3 toCamera = cameraPosition - origin;
  float lenSq = max(dot(toCamera.xz, toCamera.xz), 0.000001);
  return vec3(toCamera.x, 0.0, toCamera.z) * inversesqrt(lenSq);
}

vec3 treeImpostorBillboardRight(vec3 origin) {
  vec3 normal = treeImpostorBillboardNormal(origin);
  return vec3(normal.z, 0.0, -normal.x);
}

vec3 treeImpostorBillboardWorldPosition(vec3 localPosition) {
#ifdef USE_INSTANCING
  vec3 origin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float scale = max(length(instanceMatrix[0].xyz), 0.001);
  vec3 right = treeImpostorBillboardRight(origin);
  vTreeImpostorBillboardNormal = treeImpostorBillboardNormal(origin);
  return origin + right * localPosition.x * scale + vec3(0.0, localPosition.y * scale, 0.0);
#else
  vec3 origin = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vTreeImpostorBillboardNormal = treeImpostorBillboardNormal(origin);
  return (modelMatrix * vec4(localPosition, 1.0)).xyz;
#endif
}

void main() {
  vec2 atlasScale = treeImpostorUvRect.zw - treeImpostorUvRect.xy;
  vTreeImpostorUv = treeImpostorUvRect.xy + uv * atlasScale;
  vTreeImpostorLodFade = treeLodFade;
  vTreeImpostorLodDitherRole = treeLodDitherRole;
  vec3 worldPosition = treeImpostorBillboardWorldPosition(position);
  gl_Position = projectionMatrix * viewMatrix * vec4(worldPosition, 1.0);
}
`;

export const TREE_IMPOSTOR_FRAGMENT_SHADER = `
#define TREE_IMPOSTOR_NORMAL_DETAIL_WEIGHT 0.65
uniform sampler2D map;
uniform sampler2D normalDepthMap;
uniform float hasNormalDepthMap;
uniform float alphaTest;
varying vec2 vTreeImpostorUv;
varying vec3 vTreeImpostorBillboardNormal;
varying float vTreeImpostorLodFade;
varying float vTreeImpostorLodDitherRole;

float treeImpostorDither(vec2 fragCoord) {
  return fract(52.9829189 * fract(dot(fragCoord, vec2(0.06711056, 0.00583715))));
}

bool treeImpostorDitherKeep(float ign, float fade, float role) {
  if (role < 0.5) return ign < fade;
  return ign >= 1.0 - fade;
}

vec3 treeImpostorRelight(vec3 albedo, vec3 packedNormal, vec3 billboardNormal) {
  vec3 capturedNormal = normalize(packedNormal * 2.0 - 1.0);
  vec3 n = normalize(mix(normalize(billboardNormal), capturedNormal, TREE_IMPOSTOR_NORMAL_DETAIL_WEIGHT));
  vec3 sunDir = normalize(vec3(0.4, 0.85, 0.3));
  vec3 sunColor = vec3(1.0, 0.96, 0.88);
  vec3 skyColor = vec3(0.42, 0.48, 0.58);
  vec3 groundColor = vec3(0.18, 0.16, 0.13);
  float sun = clamp(max(dot(n, sunDir), 0.0), 0.0, 0.85);
  float sky = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
  float back = max(dot(-n, sunDir), 0.0);
  vec3 hemi = mix(groundColor, skyColor, sky);
  vec3 transmission = albedo * sunColor * back * 0.22;
  return clamp(albedo * 0.25 + albedo * (hemi + sunColor * sun) + transmission, 0.0, 1.0);
}

void main() {
  vec4 color = texture2D(map, vTreeImpostorUv);
  if (color.a < alphaTest) discard;
  if (!treeImpostorDitherKeep(treeImpostorDither(gl_FragCoord.xy), vTreeImpostorLodFade, vTreeImpostorLodDitherRole)) discard;
  vec3 albedo = color.rgb * color.rgb;
  if (hasNormalDepthMap > 0.5) {
    vec4 normalDepth = texture2D(normalDepthMap, vTreeImpostorUv);
    albedo = treeImpostorRelight(albedo, normalDepth.rgb, vTreeImpostorBillboardNormal);
  }
  gl_FragColor = vec4(albedo, color.a);
}
`;

export const TREE_IMPOSTOR_BLEND_VERTEX_SHADER = `
#define TREE_IMPOSTOR_NORMAL_DETAIL_WEIGHT 0.65
attribute vec4 treeImpostorUvRect0;
attribute vec4 treeImpostorUvRect1;
attribute vec4 treeImpostorUvRect2;
attribute vec4 treeImpostorUvRect3;
attribute vec4 treeImpostorBlendWeights;
attribute float treeLodFade;
attribute float treeLodDitherRole;
varying vec2 vTreeImpostorUv0;
varying vec2 vTreeImpostorUv1;
varying vec2 vTreeImpostorUv2;
varying vec2 vTreeImpostorUv3;
varying vec3 vTreeImpostorBillboardNormal;
varying vec4 vTreeImpostorBlendWeights;
varying float vTreeImpostorLodFade;
varying float vTreeImpostorLodDitherRole;

vec2 treeImpostorAtlasUv(vec4 rect) {
  return rect.xy + uv * (rect.zw - rect.xy);
}

vec3 treeImpostorBillboardNormal(vec3 origin) {
  vec3 toCamera = cameraPosition - origin;
  float lenSq = max(dot(toCamera.xz, toCamera.xz), 0.000001);
  return vec3(toCamera.x, 0.0, toCamera.z) * inversesqrt(lenSq);
}

vec3 treeImpostorBillboardRight(vec3 origin) {
  vec3 normal = treeImpostorBillboardNormal(origin);
  return vec3(normal.z, 0.0, -normal.x);
}

vec3 treeImpostorBillboardWorldPosition(vec3 localPosition) {
#ifdef USE_INSTANCING
  vec3 origin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float scale = max(length(instanceMatrix[0].xyz), 0.001);
  vec3 right = treeImpostorBillboardRight(origin);
  vTreeImpostorBillboardNormal = treeImpostorBillboardNormal(origin);
  return origin + right * localPosition.x * scale + vec3(0.0, localPosition.y * scale, 0.0);
#else
  vec3 origin = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vTreeImpostorBillboardNormal = treeImpostorBillboardNormal(origin);
  return (modelMatrix * vec4(localPosition, 1.0)).xyz;
#endif
}

void main() {
  vTreeImpostorUv0 = treeImpostorAtlasUv(treeImpostorUvRect0);
  vTreeImpostorUv1 = treeImpostorAtlasUv(treeImpostorUvRect1);
  vTreeImpostorUv2 = treeImpostorAtlasUv(treeImpostorUvRect2);
  vTreeImpostorUv3 = treeImpostorAtlasUv(treeImpostorUvRect3);
  vTreeImpostorBlendWeights = treeImpostorBlendWeights;
  vTreeImpostorLodFade = treeLodFade;
  vTreeImpostorLodDitherRole = treeLodDitherRole;
  vec3 worldPosition = treeImpostorBillboardWorldPosition(position);
  gl_Position = projectionMatrix * viewMatrix * vec4(worldPosition, 1.0);
}
`;

export const TREE_IMPOSTOR_BLEND_FRAGMENT_SHADER = `
#define TREE_IMPOSTOR_NORMAL_DETAIL_WEIGHT 0.65
uniform sampler2D map;
uniform sampler2D normalDepthMap;
uniform float hasNormalDepthMap;
uniform float alphaTest;
varying vec2 vTreeImpostorUv0;
varying vec2 vTreeImpostorUv1;
varying vec2 vTreeImpostorUv2;
varying vec2 vTreeImpostorUv3;
varying vec3 vTreeImpostorBillboardNormal;
varying vec4 vTreeImpostorBlendWeights;
varying float vTreeImpostorLodFade;
varying float vTreeImpostorLodDitherRole;

float treeImpostorDither(vec2 fragCoord) {
  return fract(52.9829189 * fract(dot(fragCoord, vec2(0.06711056, 0.00583715))));
}

bool treeImpostorDitherKeep(float ign, float fade, float role) {
  if (role < 0.5) return ign < fade;
  return ign >= 1.0 - fade;
}

vec3 treeImpostorRelight(vec3 albedo, vec3 packedNormal, vec3 billboardNormal) {
  vec3 capturedNormal = normalize(packedNormal * 2.0 - 1.0);
  vec3 n = normalize(mix(normalize(billboardNormal), capturedNormal, TREE_IMPOSTOR_NORMAL_DETAIL_WEIGHT));
  vec3 sunDir = normalize(vec3(0.4, 0.85, 0.3));
  vec3 sunColor = vec3(1.0, 0.96, 0.88);
  vec3 skyColor = vec3(0.42, 0.48, 0.58);
  vec3 groundColor = vec3(0.18, 0.16, 0.13);
  float sun = clamp(max(dot(n, sunDir), 0.0), 0.0, 0.85);
  float sky = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
  float back = max(dot(-n, sunDir), 0.0);
  vec3 hemi = mix(groundColor, skyColor, sky);
  vec3 transmission = albedo * sunColor * back * 0.22;
  return clamp(albedo * 0.25 + albedo * (hemi + sunColor * sun) + transmission, 0.0, 1.0);
}

vec3 treeImpostorBlendPackedNormal(vec3 n0, vec3 n1, vec3 n2, vec3 n3, vec4 weights) {
  vec3 decoded =
    (n0 * 2.0 - 1.0) * weights.x +
    (n1 * 2.0 - 1.0) * weights.y +
    (n2 * 2.0 - 1.0) * weights.z +
    (n3 * 2.0 - 1.0) * weights.w;
  float lenSq = max(dot(decoded, decoded), 0.000001);
  return decoded * inversesqrt(lenSq) * 0.5 + 0.5;
}

void main() {
  vec4 c0 = texture2D(map, vTreeImpostorUv0);
  vec4 c1 = texture2D(map, vTreeImpostorUv1);
  vec4 c2 = texture2D(map, vTreeImpostorUv2);
  vec4 c3 = texture2D(map, vTreeImpostorUv3);
  vec4 color = c0 * vTreeImpostorBlendWeights.x + c1 * vTreeImpostorBlendWeights.y + c2 * vTreeImpostorBlendWeights.z + c3 * vTreeImpostorBlendWeights.w;
  if (color.a < alphaTest) discard;
  if (!treeImpostorDitherKeep(treeImpostorDither(gl_FragCoord.xy), vTreeImpostorLodFade, vTreeImpostorLodDitherRole)) discard;
  vec3 albedo = color.rgb * color.rgb;
  if (hasNormalDepthMap > 0.5) {
    vec3 n0 = texture2D(normalDepthMap, vTreeImpostorUv0).rgb;
    vec3 n1 = texture2D(normalDepthMap, vTreeImpostorUv1).rgb;
    vec3 n2 = texture2D(normalDepthMap, vTreeImpostorUv2).rgb;
    vec3 n3 = texture2D(normalDepthMap, vTreeImpostorUv3).rgb;
    vec3 normal = treeImpostorBlendPackedNormal(n0, n1, n2, n3, vTreeImpostorBlendWeights);
    albedo = treeImpostorRelight(albedo, normal, vTreeImpostorBillboardNormal);
  }
  gl_FragColor = vec4(albedo, color.a);
}
`;
