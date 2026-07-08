import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { positionGeometry, uniform, vec3, wgslFn } from "three/tsl";
import type { FarClipmapDebugMode } from "./far_clipmap_config.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

const FAR_CLIPMAP_DEBUG_MODE_CODES: Record<FarClipmapDebugMode, number> = Object.freeze({
  final: 0,
  biome: 1,
  height: 2,
  ownership: 3,
});

const FAR_CLIPMAP_SHADER_RENDER_ORDER = 20;
const FAR_CLIPMAP_NODE_UNIFORMS = "farClipmapNodeUniforms";
const FAR_CLIPMAP_DISPLACEMENT_MODE = "farClipmapDisplacementMode";

export interface FarClipmapMaterialUniforms {
  [key: string]: THREE.IUniform<any>;
  uRingOrigin: THREE.IUniform<THREE.Vector2>;
  uCellSize: THREE.IUniform<number>;
  uHeightScale: THREE.IUniform<number>;
  uYOffset: THREE.IUniform<number>;
  uSeaLevel: THREE.IUniform<number>;
  uDebugMode: THREE.IUniform<number>;
  uClipInnerRadius: THREE.IUniform<number>;
  uClipOuterRadius: THREE.IUniform<number>;
  uCameraXZ: THREE.IUniform<THREE.Vector2>;
}

interface FarClipmapNodeUniforms {
  uRingOrigin: { value: THREE.Vector2 };
  uCellSize: { value: number };
  uHeightScale: { value: number };
  uYOffset: { value: number };
  uSeaLevel: { value: number };
  uDebugMode: { value: number };
  uClipInnerRadius: { value: number };
  uClipOuterRadius: { value: number };
  uCameraXZ: { value: THREE.Vector2 };
}

export type FarClipmapDisplacementMode = "shader" | "cpu-baked";

export type FarClipmapMaterial = THREE.Material & {
  uniforms?: FarClipmapMaterialUniforms;
};

const TERRAIN_SHADER_FUNCTIONS = `
float saturate(float value) {
  return clamp(value, 0.0, 1.0);
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float total = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 5; i++) {
    total += valueNoise(p) * amplitude;
    p *= 2.03;
    amplitude *= 0.5;
  }
  return total;
}

float farTerrainHeight(vec2 worldXZ) {
  vec2 p = worldXZ * 0.00225;
  float continent = fbm(p * 0.55) - 0.38;
  float hills = fbm(p * 4.0) * 28.0;
  float ridges = abs(fbm(p * 9.0) - 0.5) * 34.0;
  float coast = smoothstep(-0.08, 0.24, continent);
  return mix(-10.0, hills + ridges - 16.0, coast);
}

vec3 farTerrainBaseColor(float height, vec3 normal) {
  float slope = 1.0 - saturate(normal.y);
  if (height <= 0.25) return vec3(0.07, 0.18, 0.25);
  if (height < 4.0) return vec3(0.42, 0.36, 0.20);
  vec3 grass = vec3(0.20, 0.27, 0.18);
  vec3 rock = vec3(0.35, 0.34, 0.30);
  vec3 highland = vec3(0.32, 0.36, 0.24);
  vec3 color = mix(grass, rock, smoothstep(0.32, 0.72, slope));
  return mix(color, highland, smoothstep(56.0, 180.0, height) * 0.35);
}
`;

const FAR_CLIPMAP_TERRAIN_SAMPLE_WGSL = `
fn fc_hash21(p: vec2<f32>) -> f32 {
  var q = fract(p * vec2<f32>(123.34, 456.21));
  q = q + dot(q, q + 45.32);
  return fract(q.x * q.y);
}

fn fc_value_noise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = fc_hash21(i);
  let b = fc_hash21(i + vec2<f32>(1.0, 0.0));
  let c = fc_hash21(i + vec2<f32>(0.0, 1.0));
  let d = fc_hash21(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fc_fbm(p0: vec2<f32>) -> f32 {
  var p = p0;
  var total = 0.0;
  var amplitude = 0.5;
  for (var i = 0; i < 5; i = i + 1) {
    total = total + fc_value_noise(p) * amplitude;
    p = p * 2.03;
    amplitude = amplitude * 0.5;
  }
  return total;
}

fn fc_height(world_xz: vec2<f32>) -> f32 {
  let p = world_xz * 0.00225;
  let continent = fc_fbm(p * 0.55) - 0.38;
  let hills = fc_fbm(p * 4.0) * 28.0;
  let ridges = abs(fc_fbm(p * 9.0) - 0.5) * 34.0;
  let coast = smoothstep(-0.08, 0.24, continent);
  return mix(-10.0, hills + ridges - 16.0, coast);
}

fn fc_base_color(height: f32, normal_value: vec3<f32>) -> vec3<f32> {
  let slope = 1.0 - clamp(normal_value.y, 0.0, 1.0);
  if (height <= 0.25) { return vec3<f32>(0.07, 0.18, 0.25); }
  if (height < 4.0) { return vec3<f32>(0.42, 0.36, 0.20); }
  let grass = vec3<f32>(0.20, 0.27, 0.18);
  let rock = vec3<f32>(0.35, 0.34, 0.30);
  let highland = vec3<f32>(0.32, 0.36, 0.24);
  let color = mix(grass, rock, smoothstep(0.32, 0.72, slope));
  return mix(color, highland, smoothstep(56.0, 180.0, height) * 0.35);
}

fn far_clipmap_terrain_sample(
  world_xz: vec2<f32>,
  cell_size: f32,
  height_scale: f32,
  y_offset: f32,
  sea_level: f32,
  camera_xz: vec2<f32>,
  clip_outer_radius: f32,
  debug_mode: f32,
) -> vec4<f32> {
  let raw_height = fc_height(world_xz);
  let height = raw_height * height_scale + y_offset;
  let sample_step = max(cell_size, 1.0);
  let h_l = fc_height(world_xz - vec2<f32>(sample_step, 0.0)) * height_scale + y_offset;
  let h_r = fc_height(world_xz + vec2<f32>(sample_step, 0.0)) * height_scale + y_offset;
  let h_d = fc_height(world_xz - vec2<f32>(0.0, sample_step)) * height_scale + y_offset;
  let h_u = fc_height(world_xz + vec2<f32>(0.0, sample_step)) * height_scale + y_offset;
  let dx = vec3<f32>(2.0 * sample_step, h_r - h_l, 0.0);
  let dz = vec3<f32>(0.0, h_u - h_d, 2.0 * sample_step);
  let normal_value = normalize(cross(dz, dx));
  let distance_m = length(world_xz - camera_xz);
  var shaded = fc_base_color(height - sea_level, normal_value);
  let sun_dir = normalize(vec3<f32>(0.38, 0.82, 0.34));
  let direct_light = clamp(dot(normal_value, sun_dir), 0.0, 1.0);
  let ambient_light = 0.34 + 0.24 * clamp(normal_value.y, 0.0, 1.0);
  let slope = 1.0 - clamp(normal_value.y, 0.0, 1.0);
  let elevation = clamp((height + 48.0) / 220.0, 0.0, 1.0);
  shaded = mix(shaded, vec3<f32>(0.44, 0.43, 0.38), slope * 0.22);
  shaded = mix(shaded, vec3<f32>(0.42, 0.46, 0.33), elevation * 0.18);
  shaded = shaded * (ambient_light + direct_light * 0.78);
  if (height <= sea_level + 0.25) {
    let water_depth_hint = clamp((sea_level + 16.0 - height) / 32.0, 0.0, 1.0);
    let water_color = mix(vec3<f32>(0.06, 0.16, 0.23), vec3<f32>(0.10, 0.28, 0.38), 1.0 - water_depth_hint);
    shaded = mix(shaded, water_color, 0.72);
  }
  let horizon_fog = smoothstep(clip_outer_radius * 0.55, clip_outer_radius, distance_m);
  shaded = mix(shaded, vec3<f32>(0.46, 0.52, 0.50), horizon_fog * 0.36);
  if (debug_mode > 0.5 && debug_mode < 1.5) {
    shaded = fc_base_color(height - sea_level, vec3<f32>(0.0, 1.0, 0.0));
  } else if (debug_mode >= 1.5 && debug_mode < 2.5) {
    let h = clamp((height + 64.0) / 256.0, 0.0, 1.0);
    shaded = vec3<f32>(h, h, h);
  } else if (debug_mode >= 2.5 && debug_mode < 3.5) {
    let ring_edge = min(abs(distance_m - 0.0), abs(distance_m - clip_outer_radius));
    let edge_line = 1.0 - smoothstep(0.0, 16.0, ring_edge);
    shaded = mix(vec3<f32>(0.05, 0.35, 0.95), vec3<f32>(1.0, 0.82, 0.18), edge_line);
  }
  return vec4<f32>(pow(max(shaded, vec3<f32>(0.0)), vec3<f32>(0.92)), height);
}
`;

const farClipmapTerrainSampleGpu = wgslFn(FAR_CLIPMAP_TERRAIN_SAMPLE_WGSL);

const VERTEX_SHADER = `
uniform vec2 uRingOrigin;
uniform float uCellSize;
uniform float uHeightScale;
uniform float uYOffset;
uniform vec2 uCameraXZ;

varying vec2 vWorldXZ;
varying vec3 vWorldNormal;
varying float vHeight;
varying float vDistance;

${TERRAIN_SHADER_FUNCTIONS}

void main() {
  vec2 worldXZ = uRingOrigin + position.xz * uCellSize;
  float rawHeight = farTerrainHeight(worldXZ);
  float height = rawHeight * uHeightScale + uYOffset;

  float sampleStep = max(uCellSize, 1.0);
  float hL = farTerrainHeight(worldXZ - vec2(sampleStep, 0.0)) * uHeightScale + uYOffset;
  float hR = farTerrainHeight(worldXZ + vec2(sampleStep, 0.0)) * uHeightScale + uYOffset;
  float hD = farTerrainHeight(worldXZ - vec2(0.0, sampleStep)) * uHeightScale + uYOffset;
  float hU = farTerrainHeight(worldXZ + vec2(0.0, sampleStep)) * uHeightScale + uYOffset;
  vec3 dx = vec3(2.0 * sampleStep, hR - hL, 0.0);
  vec3 dz = vec3(0.0, hU - hD, 2.0 * sampleStep);

  vWorldXZ = worldXZ;
  vHeight = height;
  vDistance = length(worldXZ - uCameraXZ);
  vWorldNormal = normalize(cross(dz, dx));

  vec4 worldPosition = vec4(worldXZ.x, height, worldXZ.y, 1.0);
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const FRAGMENT_SHADER = `
precision highp float;

uniform float uSeaLevel;
uniform int uDebugMode;
uniform float uClipInnerRadius;
uniform float uClipOuterRadius;

varying vec2 vWorldXZ;
varying vec3 vWorldNormal;
varying float vHeight;
varying float vDistance;

${TERRAIN_SHADER_FUNCTIONS}

vec3 tonemapFarTerrain(vec3 color) {
  return pow(max(color, vec3(0.0)), vec3(0.92));
}

void main() {
  if (vDistance < uClipInnerRadius || vDistance > uClipOuterRadius) discard;

  vec3 normal = normalize(vWorldNormal);
  vec3 sunDir = normalize(vec3(0.38, 0.82, 0.34));
  float directLight = saturate(dot(normal, sunDir));
  float ambientLight = 0.34 + 0.24 * saturate(normal.y);
  float slope = 1.0 - saturate(normal.y);
  float elevation = saturate((vHeight + 48.0) / 220.0);

  vec3 baseColor = farTerrainBaseColor(vHeight - uSeaLevel, normal);
  vec3 rockTint = vec3(0.44, 0.43, 0.38);
  vec3 highlandTint = vec3(0.42, 0.46, 0.33);
  vec3 shadedColor = mix(baseColor, rockTint, slope * 0.22);
  shadedColor = mix(shadedColor, highlandTint, elevation * 0.18);
  shadedColor *= ambientLight + directLight * 0.78;

  if (vHeight <= uSeaLevel + 0.25) {
    float waterDepthHint = saturate((uSeaLevel + 16.0 - vHeight) / 32.0);
    vec3 waterColor = mix(vec3(0.06, 0.16, 0.23), vec3(0.10, 0.28, 0.38), 1.0 - waterDepthHint);
    shadedColor = mix(shadedColor, waterColor, 0.72);
  }

  float horizonFog = smoothstep(uClipOuterRadius * 0.55, uClipOuterRadius, vDistance);
  shadedColor = mix(shadedColor, vec3(0.46, 0.52, 0.50), horizonFog * 0.36);

  if (uDebugMode == 1) {
    shadedColor = farTerrainBaseColor(vHeight - uSeaLevel, vec3(0.0, 1.0, 0.0));
  } else if (uDebugMode == 2) {
    shadedColor = vec3(saturate((vHeight + 64.0) / 256.0));
  } else if (uDebugMode == 3) {
    float ringEdge = min(abs(vDistance - uClipInnerRadius), abs(vDistance - uClipOuterRadius));
    float edgeLine = 1.0 - smoothstep(0.0, 16.0, ringEdge);
    shadedColor = mix(vec3(0.05, 0.35, 0.95), vec3(1.0, 0.82, 0.18), edgeLine);
  }

  gl_FragColor = vec4(tonemapFarTerrain(shadedColor), 1.0);
}
`;

export function farClipmapDebugModeCode(mode: FarClipmapDebugMode): number {
  return FAR_CLIPMAP_DEBUG_MODE_CODES[mode];
}

export function farClipmapShaderRenderOrder(): number {
  return FAR_CLIPMAP_SHADER_RENDER_ORDER;
}

function createFarClipmapUniforms(input: {
  debugMode: FarClipmapDebugMode;
  seaLevel?: number;
  clipInnerRadiusM: number;
  clipOuterRadiusM: number;
  ringOriginX?: number;
  ringOriginZ?: number;
  cellSizeM?: number;
  heightScale?: number;
  yOffset?: number;
  cameraX?: number;
  cameraZ?: number;
}): FarClipmapMaterialUniforms {
  return {
    uRingOrigin: { value: new THREE.Vector2(input.ringOriginX ?? 0, input.ringOriginZ ?? 0) },
    uCellSize: { value: input.cellSizeM ?? 1 },
    uHeightScale: { value: input.heightScale ?? 1 },
    uYOffset: { value: input.yOffset ?? 0 },
    uSeaLevel: { value: input.seaLevel ?? 0 },
    uDebugMode: { value: farClipmapDebugModeCode(input.debugMode) },
    uClipInnerRadius: { value: input.clipInnerRadiusM },
    uClipOuterRadius: { value: input.clipOuterRadiusM },
    uCameraXZ: { value: new THREE.Vector2(input.cameraX ?? 0, input.cameraZ ?? 0) },
  };
}

function createFarClipmapNodeUniforms(input: {
  debugMode: FarClipmapDebugMode;
  seaLevel?: number;
  clipInnerRadiusM: number;
  clipOuterRadiusM: number;
  ringOriginX?: number;
  ringOriginZ?: number;
  cellSizeM?: number;
  heightScale?: number;
  yOffset?: number;
  cameraX?: number;
  cameraZ?: number;
}): FarClipmapNodeUniforms {
  return {
    uRingOrigin: uniform(new THREE.Vector2(input.ringOriginX ?? 0, input.ringOriginZ ?? 0)) as FarClipmapNodeUniforms["uRingOrigin"],
    uCellSize: uniform(input.cellSizeM ?? 1) as FarClipmapNodeUniforms["uCellSize"],
    uHeightScale: uniform(input.heightScale ?? 1) as FarClipmapNodeUniforms["uHeightScale"],
    uYOffset: uniform(input.yOffset ?? 0) as FarClipmapNodeUniforms["uYOffset"],
    uSeaLevel: uniform(input.seaLevel ?? 0) as FarClipmapNodeUniforms["uSeaLevel"],
    uDebugMode: uniform(farClipmapDebugModeCode(input.debugMode)) as FarClipmapNodeUniforms["uDebugMode"],
    uClipInnerRadius: uniform(input.clipInnerRadiusM) as FarClipmapNodeUniforms["uClipInnerRadius"],
    uClipOuterRadius: uniform(input.clipOuterRadiusM) as FarClipmapNodeUniforms["uClipOuterRadius"],
    uCameraXZ: uniform(new THREE.Vector2(input.cameraX ?? 0, input.cameraZ ?? 0)) as FarClipmapNodeUniforms["uCameraXZ"],
  };
}

function createWebGpuFarClipmapMaterial(input: {
  debugMode: FarClipmapDebugMode;
  seaLevel?: number;
  clipInnerRadiusM: number;
  clipOuterRadiusM: number;
  ringOriginX?: number;
  ringOriginZ?: number;
  cellSizeM?: number;
  heightScale?: number;
  yOffset?: number;
  cameraX?: number;
  cameraZ?: number;
}): FarClipmapMaterial {
  const uniforms = createFarClipmapNodeUniforms(input);
  const worldXZ: TslNode = positionGeometry.xz.mul(uniforms.uCellSize).add(uniforms.uRingOrigin);
  const terrain: TslNode = farClipmapTerrainSampleGpu({
    world_xz: worldXZ,
    cell_size: uniforms.uCellSize,
    height_scale: uniforms.uHeightScale,
    y_offset: uniforms.uYOffset,
    sea_level: uniforms.uSeaLevel,
    camera_xz: uniforms.uCameraXZ,
    clip_outer_radius: uniforms.uClipOuterRadius,
    debug_mode: uniforms.uDebugMode,
  });
  const localPosition: TslNode = vec3(
    positionGeometry.x.mul(uniforms.uCellSize),
    terrain.w,
    positionGeometry.z.mul(uniforms.uCellSize),
  );
  const distance: TslNode = worldXZ.sub(uniforms.uCameraXZ).length();

  const material = new MeshBasicNodeMaterial() as FarClipmapMaterial & MeshBasicNodeMaterial;
  material.name = "FarClipmapTerrainNodeShader";
  material.positionNode = localPosition;
  material.colorNode = terrain.xyz;
  material.maskNode = distance.greaterThanEqual(uniforms.uClipInnerRadius).and(distance.lessThanEqual(uniforms.uClipOuterRadius));
  material.depthWrite = true;
  material.depthTest = true;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -1;
  material.transparent = false;
  material.side = THREE.FrontSide;
  material.toneMapped = true;
  material.userData[FAR_CLIPMAP_NODE_UNIFORMS] = uniforms;
  material.userData[FAR_CLIPMAP_DISPLACEMENT_MODE] = "shader" satisfies FarClipmapDisplacementMode;
  return material;
}

export function createFarClipmapMaterial(input: {
  debugMode: FarClipmapDebugMode;
  seaLevel?: number;
  clipInnerRadiusM: number;
  clipOuterRadiusM: number;
  ringOriginX?: number;
  ringOriginZ?: number;
  cellSizeM?: number;
  heightScale?: number;
  yOffset?: number;
  cameraX?: number;
  cameraZ?: number;
  webGpuCompatible?: boolean;
}): FarClipmapMaterial {
  if (input.webGpuCompatible === true) return createWebGpuFarClipmapMaterial(input);
  const material = new THREE.ShaderMaterial({
    name: "FarClipmapTerrainShader",
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: createFarClipmapUniforms(input),
    depthWrite: true,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    transparent: false,
    side: THREE.FrontSide,
  }) as FarClipmapMaterial;
  material.userData[FAR_CLIPMAP_DISPLACEMENT_MODE] = "shader" satisfies FarClipmapDisplacementMode;
  return material;
}

export function farClipmapMaterialDisplacementMode(material: FarClipmapMaterial): FarClipmapDisplacementMode {
  return material.userData[FAR_CLIPMAP_DISPLACEMENT_MODE] === "cpu-baked" ? "cpu-baked" : "shader";
}

export function setFarClipmapMaterialDebugMode(material: FarClipmapMaterial, mode: FarClipmapDebugMode): void {
  const code = farClipmapDebugModeCode(mode);
  if (material.uniforms) material.uniforms.uDebugMode.value = code;
  const nodeUniforms = material.userData[FAR_CLIPMAP_NODE_UNIFORMS] as FarClipmapNodeUniforms | undefined;
  if (nodeUniforms) nodeUniforms.uDebugMode.value = code;
}

export function updateFarClipmapMaterialFrameUniforms(material: FarClipmapMaterial, input: {
  cameraX: number;
  cameraZ: number;
  clipInnerRadiusM: number;
  clipOuterRadiusM: number;
  ringOriginX: number;
  ringOriginZ: number;
  cellSizeM: number;
  heightScale: number;
  yOffset: number;
}): void {
  if (material.uniforms) {
    material.uniforms.uCameraXZ.value.set(input.cameraX, input.cameraZ);
    material.uniforms.uClipInnerRadius.value = input.clipInnerRadiusM;
    material.uniforms.uClipOuterRadius.value = input.clipOuterRadiusM;
    material.uniforms.uRingOrigin.value.set(input.ringOriginX, input.ringOriginZ);
    material.uniforms.uCellSize.value = input.cellSizeM;
    material.uniforms.uHeightScale.value = input.heightScale;
    material.uniforms.uYOffset.value = input.yOffset;
  }
  const nodeUniforms = material.userData[FAR_CLIPMAP_NODE_UNIFORMS] as FarClipmapNodeUniforms | undefined;
  if (nodeUniforms) {
    nodeUniforms.uCameraXZ.value.set(input.cameraX, input.cameraZ);
    nodeUniforms.uClipInnerRadius.value = input.clipInnerRadiusM;
    nodeUniforms.uClipOuterRadius.value = input.clipOuterRadiusM;
    nodeUniforms.uRingOrigin.value.set(input.ringOriginX, input.ringOriginZ);
    nodeUniforms.uCellSize.value = input.cellSizeM;
    nodeUniforms.uHeightScale.value = input.heightScale;
    nodeUniforms.uYOffset.value = input.yOffset;
  }
}
