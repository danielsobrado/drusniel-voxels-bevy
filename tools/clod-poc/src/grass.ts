import * as THREE from "three";
import {
  StorageBufferAttribute,
  StorageInstancedBufferAttribute,
} from "three/webgpu";
import { materialWeights, surfaceHeight, surfaceNormal, WATER_LEVEL } from "./terrain.js";
import type { ClodPageNode, PageFootprint } from "./types.js";
import {
  GRASS_GPU_CANDIDATE_FLOATS,
  GrassGpuRingCompute,
  grassGpuRingComputeUnsupportedReason,
  type GrassGpuCandidateBuffer,
  type GrassGpuRingOutputBuffers,
  type GrassGpuRingStats,
  type GrassGpuTierOutputBuffers,
} from "./gpu/grass_ring_compute.js";

const TWO_PI = Math.PI * 2;
const MIN_GRASS_WEIGHT = 0.05;
const BLADE_ROWS = [
  [0, 1],
  [0.35, 0.75],
  [0.7, 0.4],
  [1, 0],
] as const;
const V2_NEAR_BLADE_ROWS = [
  [0, 1],
  [0.55, 0.6],
  [1, 0],
] as const;
const V2_MID_BLADE_ROWS = [
  [0, 0.78],
  [1, 0],
] as const;
export const GRASS_SHADER_MODES = ["terrain-patch-v2", "webgpu-ring-v1", "classic"] as const;
export type GrassShaderMode = typeof GRASS_SHADER_MODES[number];
export const DEFAULT_GRASS_SHADER_MODE: GrassShaderMode = "terrain-patch-v2";
const V2_NEAR_DISTANCE_FRACTION = 0.42;
const V2_MID_DISTANCE_FRACTION = 0.78;
const V2_MID_INSTANCE_FRACTION = 0.35;
const V2_FAR_INSTANCE_FRACTION = 0.12;
const V2_SUPER_INSTANCE_FRACTION = 0.045;
const V2_EDGE_SAMPLE_SCALE = 1.25;
const V2_EDGE_HEIGHT_SOFT = 1.5;
const V2_EDGE_HEIGHT_HARD = 4.5;
const PATCH_REFRESH_DISTANCE = 4;
const RING_REFRESH_CELLS = 4;
const RING_MAX_RADIUS = 220;
const RING_MAX_AXIS_CELLS = 220;
const RING_NEAR_METERS = 36;
const RING_MID_METERS = 110;
const RING_FAR_METERS = 170;
const RING_FAR_DISTANCE_FRACTION = 0.94;
const RING_SCRUFF_METERS = 24;
const GRASS_WATER_CLEARANCE = 0.18;
// Max new grass patches (scatter + InstancedBufferGeometry build) per refreshPatches call. Caps
// the per-frame cost so walking across page boundaries doesn't scatter many patches in one frame;
// the rest build over the next frames via patchesDirty. Trade: grass fills in over a few frames.
const MAX_NEW_PATCHES_PER_REFRESH = 2;

const VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uBladeWidth;
  uniform float uWindStrength;
  uniform float uWindSpeed;
  attribute vec3 aOffset;
  attribute float aHeight;
  attribute float aRotY;
  attribute float aPhase;
  attribute float aColorMix;
  attribute float aWidthScale;
  varying vec2 vUv;
  varying float vColorMix;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  void main() {
    float bend = uv.y * uv.y;
    float windTime = uTime * uWindSpeed + aPhase + aOffset.x * 0.071 + aOffset.z * 0.053;
    vec2 wind = vec2(sin(windTime), cos(windTime * 0.83 + aPhase * 0.37));
    wind *= uWindStrength * aHeight * bend;

    vec3 localPosition = vec3(position.x * uBladeWidth * aWidthScale, position.y * aHeight, position.z * uBladeWidth * aWidthScale);
    localPosition.xz += wind;

    float c = cos(aRotY);
    float s = sin(aRotY);
    vec3 rotatedPosition = vec3(
      c * localPosition.x + s * localPosition.z,
      localPosition.y,
      -s * localPosition.x + c * localPosition.z
    );
    vec3 localNormal = normalize(vec3(
      normal.x - wind.x * 0.35,
      normal.y + bend * 0.16,
      normal.z - wind.y * 0.35
    ));
    vWorldNormal = normalize(vec3(
      c * localNormal.x + s * localNormal.z,
      localNormal.y,
      -s * localNormal.x + c * localNormal.z
    ));
    vWorldPos = aOffset + rotatedPosition;
    vUv = uv;
    vColorMix = aColorMix;
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  uniform vec3 uLight;
  uniform vec3 uSunColor;
  uniform vec3 uSkyLight;
  uniform vec3 uGroundLight;
  varying vec2 vUv;
  varying float vColorMix;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  void main() {
    vec3 darkGreen = vec3(0.035, 0.12, 0.025);
    vec3 midGreen = vec3(0.12, 0.34, 0.055);
    vec3 tipGreen = vec3(0.34, 0.56, 0.12);
    vec3 dryGrass = vec3(0.52, 0.42, 0.12);
    vec3 grassColor = mix(darkGreen, midGreen, smoothstep(0.0, 0.62, vUv.y));
    grassColor = mix(grassColor, tipGreen, smoothstep(0.58, 1.0, vUv.y));
    grassColor = mix(grassColor, dryGrass, vColorMix * 0.58);

    vec3 n = normalize(vWorldNormal);
    if (!gl_FrontFacing) n = -n;
    vec3 lightDirection = normalize(uLight);
    float sun = max(dot(n, lightDirection), 0.0);
    float back = max(dot(-n, lightDirection), 0.0);
    float sky = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 hemi = mix(uGroundLight, uSkyLight, sky);
    vec3 direct = uSunColor * pow(sun, 1.25);
    vec3 transmission = vec3(0.46, 0.55, 0.12) * back * (0.16 + vUv.y * 0.5);
    gl_FragColor = vec4(grassColor * (hemi + direct) + transmission * grassColor, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const TERRAIN_PATCH_VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uBladeWidth;
  uniform float uWindStrength;
  uniform float uWindSpeed;
  uniform float uNearDistance;
  uniform float uMidDistance;
  uniform float uFadeDistance;
  attribute vec3 aOffset;
  attribute float aHeight;
  attribute float aRotY;
  attribute float aPhase;
  attribute float aColorMix;
  attribute float aEdgeFade;
  attribute float aNormalY;
  attribute float aWidthScale;
  attribute vec3 aTerrainNormal;
  varying vec2 vUv;
  varying float vColorMix;
  varying float vEdgeFade;
  varying float vDistanceFade;
  varying vec3 vWorldNormal;

  void main() {
    float dist = distance(cameraPosition.xz, aOffset.xz);
    float farFade = 1.0 - smoothstep(uFadeDistance * 0.9, uFadeDistance, dist);
    float nearWeight = 1.0 - smoothstep(uNearDistance * 0.75, uNearDistance, dist);
    float heightFactor = uv.y * uv.y;
    float edge = clamp(aEdgeFade, 0.0, 1.0);
    vec3 terrainNormal = normalize(aTerrainNormal);
    float slope = smoothstep(0.55, 0.96, terrainNormal.y);
    float bendPower = heightFactor * edge * (0.55 + nearWeight * 0.45);

    float windTime = uTime * uWindSpeed + aPhase + aOffset.x * 0.049 + aOffset.z * 0.037;
    vec2 wind = vec2(
      sin(windTime),
      sin(windTime * 0.61 + aOffset.z * 0.021)
    ) * uWindStrength * aHeight * bendPower;

    float edgeHeight = mix(0.35, 1.0, edge);
    float slopeHeight = mix(0.55, 1.0, slope);
    float widthTaper = mix(1.35, 0.85, uv.y);
    vec3 localPosition = vec3(
      position.x * uBladeWidth * widthTaper * aWidthScale,
      position.y * aHeight * edgeHeight * slopeHeight,
      position.z * uBladeWidth * widthTaper * aWidthScale
    );
    localPosition.xz += wind;
    localPosition.y -= length(wind) * 0.08 * heightFactor;

    float c = cos(aRotY);
    float s = sin(aRotY);
    vec3 rotatedPosition = vec3(
      c * localPosition.x + s * localPosition.z,
      localPosition.y,
      -s * localPosition.x + c * localPosition.z
    );
    vec3 localNormal = normalize(vec3(
      normal.x - wind.x * 0.28,
      normal.y + 0.18 + uv.y * 0.28,
      normal.z - wind.y * 0.24
    ));
    vec3 bladeNormal = normalize(vec3(
      c * localNormal.x + s * localNormal.z,
      localNormal.y,
      -s * localNormal.x + c * localNormal.z
    ));
    float terrainNormalPull = smoothstep(0.18, 1.0, uv.y) * 0.35;
    vWorldNormal = normalize(mix(bladeNormal, terrainNormal, terrainNormalPull));
    vUv = uv;
    vColorMix = aColorMix;
    vEdgeFade = edge;
    vDistanceFade = farFade;
    gl_Position = projectionMatrix * viewMatrix * vec4(aOffset + rotatedPosition, 1.0);
  }
`;

const TERRAIN_PATCH_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  uniform vec3 uLight;
  uniform vec3 uSunColor;
  uniform vec3 uSkyLight;
  uniform vec3 uGroundLight;
  varying vec2 vUv;
  varying float vColorMix;
  varying float vEdgeFade;
  varying float vDistanceFade;
  varying vec3 vWorldNormal;
  uniform float uAlphaToCoverage;

  // Ordered-dither fallback (used when alpha-to-coverage is off). Recursive 2x2 -> 4x4 Bayer
  // matrix in [0,1), no array indexing so it stays WebGL1-safe.
  float bayer2(vec2 a) {
    a = floor(a);
    return fract(a.x * 0.5 + a.y * a.y * 0.75);
  }
  float bayer4(vec2 a) {
    return bayer2(a * 0.5) * 0.25 + bayer2(a);
  }

  void main() {
    // Soft coverage from the distance + edge fades. Both paths stay in the OPAQUE pass
    // (early-Z, no blended overdraw): alpha-to-coverage emits coverage as alpha so the MSAA
    // hardware builds a smooth sample mask; the fallback is an ordered screen-door cutout.
    float coverage = smoothstep(0.0, 0.08, vDistanceFade) * smoothstep(0.08, 0.45, vEdgeFade);
    bool a2c = uAlphaToCoverage > 0.5;
    float cutoff = a2c ? 0.003 : bayer4(gl_FragCoord.xy);
    if (coverage < cutoff) discard;

    vec3 base = vec3(0.04, 0.16, 0.035);
    vec3 mid = vec3(0.16, 0.36, 0.075);
    vec3 tip = vec3(0.43, 0.58, 0.16);
    vec3 dry = vec3(0.48, 0.38, 0.11);
    vec3 color = mix(base, mid, smoothstep(0.0, 0.7, vUv.y));
    color = mix(color, tip, smoothstep(0.62, 1.0, vUv.y));
    color = mix(color, dry, vColorMix * 0.42);

    vec3 n = normalize(vWorldNormal);
    if (!gl_FrontFacing) n = -n;
    vec3 lightDirection = normalize(uLight);
    float sun = max(dot(n, lightDirection), 0.0);
    float wrap = clamp(dot(n, lightDirection) * 0.45 + 0.55, 0.0, 1.0);
    float sky = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 hemi = mix(uGroundLight, uSkyLight, sky);
    vec3 direct = uSunColor * (sun * 0.65 + wrap * 0.28);
    vec3 transmission = vec3(0.42, 0.52, 0.12) * max(dot(-n, lightDirection), 0.0) * (0.14 + vUv.y * 0.42);
    gl_FragColor = vec4(color * (hemi + direct) + transmission * color, a2c ? coverage : 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface GrassSettings {
  enabled: boolean;
  shaderMode: GrassShaderMode;
  alphaToCoverage: boolean;
  nearCrossedQuads: boolean;
  distance: number;
  bladeSpacing: number;
  bladeHeight: number;
  bladeHeightVariation: number;
  bladeWidth: number;
  windStrength: number;
  windSpeed: number;
  slopeMinY: number;
  minHeight: number;
  maxHeight: number;
  maxBlades: number;
  seed: number;
}

export interface GrassLighting {
  light: THREE.Vector3;
  sunColor: THREE.Color;
  skyLight: THREE.Color;
  groundLight: THREE.Color;
}

export interface GrassSystemOptions {
  scene: THREE.Scene;
  nodes: ClodPageNode[];
  worldCells: number;
  settings: GrassSettings;
  lighting: GrassLighting;
  supportsRing?: boolean;
  gpuDevice?: GPUDevice | null;
  gpuBackend?: GrassWebGpuBackendAccess | null;
  material?: GrassMaterialHandle;
  createMaterial?: GrassMaterialFactory;
  buildGeometry?: GrassGeometryBuilder;
}

export interface GrassWebGpuBackendAccess {
  createStorageAttribute(attribute: THREE.BufferAttribute): void;
  createIndirectStorageAttribute(attribute: THREE.BufferAttribute): void;
  get(attribute: THREE.BufferAttribute): { buffer?: GPUBuffer };
}

export interface GrassBladeInstance {
  offset: [number, number, number];
  height: number;
  rotationY: number;
  phase: number;
  colorMix: number;
  edgeFade: number;
  normalY: number;
  terrainNormal: [number, number, number];
  widthScale?: number;
}

export interface GrassGeometryOptions {
  mode: GrassShaderMode;
  tier: GrassTier;
  crossed?: boolean;
}

export type GrassGeometryBuilder = (
  instances: readonly GrassBladeInstance[],
  options: GrassGeometryOptions,
) => THREE.InstancedBufferGeometry;

export interface GrassMaterialHandle {
  material: THREE.Material;
  setTime?(timeSeconds: number): void;
  setFadeCenter?(x: number, z: number): void;
  updateSettings?(settings: GrassSettings): void;
  updateLighting?(lighting: GrassLighting): void;
  dispose?(): void;
}

export type GrassMaterialFactory = (
  settings: GrassSettings,
  lighting: GrassLighting,
) => GrassMaterialHandle;

export interface GrassCandidateSample {
  height: number;
  normalY: number;
  grassWeight: number;
  threshold: number;
  waterDepth?: number;
  rockWeight?: number;
  snowWeight?: number;
}

export interface GrassStats {
  mode: GrassShaderMode;
  blades: number;
  patches: number;
  visiblePatches: number;
  culledPatches: number;
  nearPatches: number;
  midPatches: number;
  coveragePatches: number;
  superPatches: number;
  generatedCandidates: number;
  acceptedCandidates: number;
  edgeSuppressedCandidates: number;
  midBladeCount: number;
  gpuRingStatus: GrassGpuRingStats["status"];
  gpuRingCandidateCount: number;
  gpuRingVisibleNear: number;
  gpuRingVisibleMid: number;
  gpuRingVisibleFar: number;
  gpuRingVisibleSuper: number;
  gpuRingDispatchMs: number | null;
  gpuRingReadbackMs: number | null;
}

export interface GrassGenerationStats {
  generatedCandidates: number;
  acceptedCandidates: number;
  edgeSuppressedCandidates: number;
}

interface GrassRingTierInstances {
  near: GrassBladeInstance[];
  mid: GrassBladeInstance[];
  far: GrassBladeInstance[];
  super: GrassBladeInstance[];
}

export interface GrassRingGenerationResult extends GrassRingTierInstances {
  stats: GrassGenerationStats;
  cellSize: number;
  radius: number;
  centerCellX: number;
  centerCellZ: number;
}

interface GrassPatch {
  nodeId: string;
  meshes: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>[];
  centerX: number;
  centerZ: number;
  radius: number;
  bladeCount: number;
  midBladeCount: number;
  visibleTier: "hidden" | GrassTier;
}

interface GrassGpuTierDrawResources {
  mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>;
  offset: StorageInstancedBufferAttribute;
  packed0: StorageInstancedBufferAttribute;
  packed1: StorageInstancedBufferAttribute;
  terrainNormal: StorageInstancedBufferAttribute;
}

type GrassGpuSharedDrawAttributes = Omit<GrassGpuTierDrawResources, "mesh">;

type IndirectInstancedBufferGeometry = THREE.InstancedBufferGeometry & {
  setIndirect?(attribute: THREE.BufferAttribute, offset: number): void;
};

function grassGpuRingDrawUnsupportedReason(): string | null {
  const prototype = THREE.InstancedBufferGeometry.prototype as IndirectInstancedBufferGeometry;
  return typeof prototype.setIndirect === "function"
    ? null
    : "webgpu-ring-v1 requires InstancedBufferGeometry.setIndirect support";
}

interface GrassGpuRingDrawResources {
  tiers: Record<GrassTier, GrassGpuTierDrawResources>;
  indirect: StorageBufferAttribute;
  outputBuffers: GrassGpuRingOutputBuffers;
}

export type GrassTier = "near" | "mid" | "far" | "super";

export interface GrassTerrainSite {
  height: number;
  normalY: number;
  terrainNormal: [number, number, number];
  materialWeights: [number, number, number, number];
  grassMask: number;
  grassWeight: number;
  rockWeight: number;
  sandWeight: number;
  snowWeight: number;
  wetBank: number;
  waterDepth: number;
  slopeMask: number;
}

export const DEFAULT_GRASS_SETTINGS: GrassSettings = {
  enabled: true,
  shaderMode: DEFAULT_GRASS_SHADER_MODE,
  alphaToCoverage: false,
  nearCrossedQuads: true,
  distance: 96,
  bladeSpacing: 1.6,
  bladeHeight: 1.15,
  bladeHeightVariation: 0.75,
  bladeWidth: 0.08,
  windStrength: 0.32,
  windSpeed: 1.35,
  slopeMinY: 0.72,
  minHeight: 12,
  maxHeight: 24,
  maxBlades: 48000,
  seed: 1337,
};

export function isGrassShaderMode(value: unknown): value is GrassShaderMode {
  return typeof value === "string" && (GRASS_SHADER_MODES as readonly string[]).includes(value);
}

interface GrassShaderDefinition {
  vertexShader: string;
  fragmentShader: string;
  patchStyle: "classic" | "terrain-patch";
  usesTerrainPatchPlacement: boolean;
}

const GRASS_SHADER_DEFINITIONS: Record<GrassShaderMode, GrassShaderDefinition> = {
  "terrain-patch-v2": {
    vertexShader: TERRAIN_PATCH_VERTEX_SHADER,
    fragmentShader: TERRAIN_PATCH_FRAGMENT_SHADER,
    patchStyle: "terrain-patch",
    usesTerrainPatchPlacement: true,
  },
  "webgpu-ring-v1": {
    vertexShader: TERRAIN_PATCH_VERTEX_SHADER,
    fragmentShader: TERRAIN_PATCH_FRAGMENT_SHADER,
    patchStyle: "terrain-patch",
    usesTerrainPatchPlacement: true,
  },
  classic: {
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    patchStyle: "classic",
    usesTerrainPatchPlacement: false,
  },
};

function grassShaderDefinition(mode: GrassShaderMode): GrassShaderDefinition {
  return GRASS_SHADER_DEFINITIONS[mode];
}

export function hash2(x: number, z: number, seed: number): number {
  let value = seed | 0;
  value ^= Math.imul(x | 0, 0x27d4eb2d);
  value ^= Math.imul(z | 0, 0x165667b1);
  value = Math.imul(value ^ (value >>> 15), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

export function randomSigned(x: number, z: number, seed: number): number {
  return hash2(x, z, seed) * 2 - 1;
}

export function acceptsGrassCandidate(settings: GrassSettings, sample: GrassCandidateSample): boolean {
  return sample.normalY >= settings.slopeMinY
    && sample.height >= settings.minHeight
    && sample.height <= settings.maxHeight
    && (sample.waterDepth ?? 0) <= 0
    && (sample.rockWeight ?? 0) < 0.82
    && (sample.snowWeight ?? 0) < 0.55
    && sample.grassWeight > MIN_GRASS_WEIGHT
    && sample.threshold < sample.grassWeight;
}

export function grassThin(distance: number): number {
  const base = Math.min(1, 58 / (Math.max(1, distance) + 42)) ** 1.15;
  const far = (120 / Math.max(distance, 120)) ** 1.6;
  return THREE.MathUtils.clamp(base * far, 0.02, 1);
}

export function grassRingBands(settings: GrassSettings): { near: number; mid: number; far: number; radius: number } {
  return {
    radius: Math.max(0, Math.min(settings.distance, RING_MAX_RADIUS)),
    near: Math.min(settings.distance * V2_NEAR_DISTANCE_FRACTION, RING_NEAR_METERS),
    mid: Math.min(settings.distance * V2_MID_DISTANCE_FRACTION, RING_MID_METERS),
    far: Math.min(settings.distance * RING_FAR_DISTANCE_FRACTION, RING_FAR_METERS),
  };
}

function ringCellSize(settings: GrassSettings, radius: number): number {
  return Math.max(0.5, settings.bladeSpacing, (radius * 2) / RING_MAX_AXIS_CELLS);
}

function grassFadeDistance(settings: Pick<GrassSettings, "distance" | "shaderMode">): number {
  return settings.shaderMode === "webgpu-ring-v1"
    ? Math.min(settings.distance, RING_MAX_RADIUS)
    : settings.distance;
}

function grassGpuCandidateKey(settings: GrassSettings, worldCells: number): string {
  return [
    worldCells,
    settings.distance,
    settings.bladeSpacing,
    settings.bladeHeight,
    settings.bladeHeightVariation,
    settings.slopeMinY,
    settings.minHeight,
    settings.maxHeight,
    settings.maxBlades,
    settings.seed,
  ].join("|");
}

export function buildGrassGpuCandidateBuffer(
  settings: GrassSettings,
  worldCells: number,
  maxCandidates = Math.max(settings.maxBlades, settings.maxBlades * 4),
): GrassGpuCandidateBuffer {
  const bands = grassRingBands(settings);
  const spacing = ringCellSize(settings, bands.radius);
  const columns = Math.max(0, Math.ceil(worldCells / spacing));
  const rows = columns;
  const stats = {
    generatedCandidates: 0,
    acceptedCandidates: 0,
  };
  const ranked: { priority: number; values: number[] }[] = [];

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      stats.generatedCandidates++;
      const jitterX = randomSigned(column, row, settings.seed + 5101) * spacing * 0.42;
      const jitterZ = randomSigned(column, row, settings.seed + 5209) * spacing * 0.42;
      const x = THREE.MathUtils.clamp((column + 0.5) * spacing + jitterX, 0.001, worldCells - 0.001);
      const z = THREE.MathUtils.clamp((row + 0.5) * spacing + jitterZ, 0.001, worldCells - 0.001);
      const site = sampleGrassTerrainSite(x, z, settings);
      if (!acceptsGrassCandidate(settings, {
        height: site.height,
        normalY: site.normalY,
        grassWeight: site.grassMask,
        waterDepth: site.waterDepth,
        rockWeight: site.rockWeight,
        snowWeight: site.snowWeight,
        threshold: hash2(column, row, settings.seed + 5303),
      })) continue;
      const edgeFade = edgeFadeForCandidate(x, z, site.height, site.normalY, spacing);
      if (edgeFade < 0.18) continue;

      stats.acceptedCandidates++;
      const heightScale = Math.max(
        0.1,
        1 + randomSigned(column, row, settings.seed + 5407) * settings.bladeHeightVariation,
      );
      ranked.push({
        priority: hash2(column, row, settings.seed + 5501),
        values: [
          x, site.height + 0.02, z, settings.bladeHeight * heightScale,
          site.terrainNormal[0], site.terrainNormal[1], site.terrainNormal[2], edgeFade,
          site.grassMask,
          hash2(column, row, settings.seed + 5603) * TWO_PI,
          hash2(column, row, settings.seed + 5701) * TWO_PI,
          Math.min(1, Math.pow(hash2(column, row, settings.seed + 5801), 2) + site.wetBank * 0.16 + site.sandWeight * 0.12),
        ],
      });
    }
  }

  ranked.sort((a, b) => a.priority - b.priority);
  const count = Math.min(ranked.length, Math.max(0, Math.floor(maxCandidates)));
  const data = new Float32Array(Math.max(1, count) * GRASS_GPU_CANDIDATE_FLOATS);
  for (let i = 0; i < count; i++) {
    data.set(ranked[i].values, i * GRASS_GPU_CANDIDATE_FLOATS);
  }
  return {
    data,
    count,
    generatedCandidates: stats.generatedCandidates,
    acceptedCandidates: stats.acceptedCandidates,
  };
}

export function sampleGrassTerrainSite(
  x: number,
  z: number,
  settings: Pick<GrassSettings, "slopeMinY"> = DEFAULT_GRASS_SETTINGS,
  distanceFromCamera = Number.POSITIVE_INFINITY,
): GrassTerrainSite {
  const height = surfaceHeight(x, z);
  const normal = surfaceNormal(x, z);
  const normalY = normal[1];
  const weights = materialWeights(height, normalY);
  const [grassWeight, rockWeight, sandWeight, snowWeight] = weights;
  const waterDepth = Math.max(0, WATER_LEVEL + GRASS_WATER_CLEARANCE - height);
  const aboveWaterMask = THREE.MathUtils.smoothstep(height, WATER_LEVEL + GRASS_WATER_CLEARANCE, WATER_LEVEL + 3.5);
  const slopeMask = THREE.MathUtils.smoothstep(
    normalY,
    Math.max(0, settings.slopeMinY - 0.04),
    Math.min(1, settings.slopeMinY + 0.16),
  );
  const rockReject = THREE.MathUtils.smoothstep(rockWeight, 0.48, 0.84);
  const snowReject = THREE.MathUtils.smoothstep(snowWeight, 0.08, 0.55);
  const bankHeight = (1 - THREE.MathUtils.smoothstep(height, WATER_LEVEL + 1.0, WATER_LEVEL + 8.0))
    * THREE.MathUtils.smoothstep(height, WATER_LEVEL + GRASS_WATER_CLEARANCE, WATER_LEVEL + 2.5);
  const wetBank = bankHeight * THREE.MathUtils.smoothstep(normalY, 0.42, 0.82);
  const wetBankThinning = 1 - wetBank * 0.58;
  const viableMask = aboveWaterMask * slopeMask * (1 - rockReject) * (1 - snowReject);
  const scruff = (1 - THREE.MathUtils.smoothstep(distanceFromCamera, RING_SCRUFF_METERS * 0.45, RING_SCRUFF_METERS))
    * viableMask
    * 0.18;
  const grassMask = THREE.MathUtils.clamp(
    Math.max(grassWeight * viableMask * wetBankThinning, scruff),
    0,
    1,
  );
  return {
    height,
    normalY,
    terrainNormal: [normal[0], normal[1], normal[2]],
    materialWeights: weights,
    grassMask,
    grassWeight,
    rockWeight,
    sandWeight,
    snowWeight,
    wetBank,
    waterDepth,
    slopeMask,
  };
}

export function generateGrassRingInstances(
  center: Pick<THREE.Vector3, "x" | "z">,
  settings: GrassSettings,
  worldCells: number,
  maxBlades = settings.maxBlades,
): GrassRingGenerationResult {
  const bands = grassRingBands(settings);
  const radius = bands.radius;
  const cellSize = ringCellSize(settings, radius);
  const centerCellX = Math.floor(center.x / cellSize);
  const centerCellZ = Math.floor(center.z / cellSize);
  const cellRadius = Math.ceil(radius / cellSize);
  const nearDistance = bands.near;
  const midDistance = bands.mid;
  const farDistance = bands.far;
  const stats: GrassGenerationStats = {
    generatedCandidates: 0,
    acceptedCandidates: 0,
    edgeSuppressedCandidates: 0,
  };
  const ranked: {
    priority: number;
    tier: GrassTier;
    instance: GrassBladeInstance;
  }[] = [];

  for (let dz = -cellRadius; dz <= cellRadius; dz++) {
    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
      stats.generatedCandidates++;
      const cellX = centerCellX + dx;
      const cellZ = centerCellZ + dz;
      const jitterX = randomSigned(cellX, cellZ, settings.seed + 1103) * cellSize * 0.42;
      const jitterZ = randomSigned(cellX, cellZ, settings.seed + 1201) * cellSize * 0.42;
      const x = THREE.MathUtils.clamp((cellX + 0.5) * cellSize + jitterX, 0.001, worldCells - 0.001);
      const z = THREE.MathUtils.clamp((cellZ + 0.5) * cellSize + jitterZ, 0.001, worldCells - 0.001);
      const distance = Math.hypot(center.x - x, center.z - z);
      if (distance > radius || x <= 0 || z <= 0 || x >= worldCells || z >= worldCells) continue;

      const site = sampleGrassTerrainSite(x, z, settings, distance);
      if (!acceptsGrassCandidate(settings, {
        height: site.height,
        normalY: site.normalY,
        grassWeight: site.grassMask,
        waterDepth: site.waterDepth,
        rockWeight: site.rockWeight,
        snowWeight: site.snowWeight,
        threshold: hash2(cellX, cellZ, settings.seed + 1301),
      })) continue;

      const edgeFade = edgeFadeForCandidate(x, z, site.height, site.normalY, cellSize);
      if (edgeFade < 0.18) {
        stats.edgeSuppressedCandidates++;
        continue;
      }

      const thin = grassThin(distance);
      const ringEdge = 1 - THREE.MathUtils.smoothstep(distance, radius * 0.9, radius);
      if (hash2(cellX, cellZ, settings.seed + 1409) >= site.grassMask * edgeFade * thin * ringEdge) continue;

      stats.acceptedCandidates++;
      const heightScale = Math.max(
        0.1,
        1 + randomSigned(cellX, cellZ, settings.seed + 1501) * settings.bladeHeightVariation,
      );
      const widthScale = THREE.MathUtils.clamp(1 / Math.sqrt(thin), 1, 4);
      const tier: GrassTier = distance <= nearDistance
        ? "near"
        : distance <= midDistance ? "mid" : distance <= farDistance ? "far" : "super";
      const tierHeight = tier === "near" ? 1 : tier === "mid" ? 1.35 : tier === "far" ? 1.75 : 2.25;
      ranked.push({
        priority: hash2(cellX, cellZ, settings.seed + 1601),
        tier,
        instance: {
          offset: [x, site.height + 0.02, z],
          height: settings.bladeHeight * heightScale * tierHeight,
          rotationY: hash2(cellX, cellZ, settings.seed + 1709) * TWO_PI,
          phase: hash2(cellX, cellZ, settings.seed + 1801) * TWO_PI,
          colorMix: Math.min(1, Math.pow(hash2(cellX, cellZ, settings.seed + 1901), 2) + site.wetBank * 0.16 + site.sandWeight * 0.12),
          edgeFade,
          normalY: site.normalY,
          terrainNormal: site.terrainNormal,
          widthScale: tier === "super" ? Math.min(4.8, widthScale * 1.35) : widthScale,
        },
      });
    }
  }

  ranked.sort((a, b) => a.priority - b.priority);
  const limit = Math.max(0, Math.floor(maxBlades));
  const tiers: GrassRingTierInstances = { near: [], mid: [], far: [], super: [] };
  for (let i = 0; i < ranked.length && i < limit; i++) {
    const item = ranked[i];
    tiers[item.tier].push(item.instance);
  }

  return {
    ...tiers,
    stats,
    cellSize,
    radius,
    centerCellX,
    centerCellZ,
  };
}

function edgeFadeForCandidate(x: number, z: number, height: number, normalY: number, spacing: number): number {
  const sampleDistance = Math.max(0.75, spacing * V2_EDGE_SAMPLE_SCALE);
  const samples = [
    surfaceHeight(x + sampleDistance, z),
    surfaceHeight(x - sampleDistance, z),
    surfaceHeight(x, z + sampleDistance),
    surfaceHeight(x, z - sampleDistance),
  ];
  const maxDelta = samples.reduce((max, neighbor) => Math.max(max, Math.abs(neighbor - height)), 0);
  const heightFade = 1 - THREE.MathUtils.smoothstep(maxDelta, V2_EDGE_HEIGHT_SOFT, V2_EDGE_HEIGHT_HARD);
  const slopeFade = THREE.MathUtils.smoothstep(normalY, 0.55, 0.9);
  return THREE.MathUtils.clamp(heightFade * slopeFade, 0, 1);
}

export function generateGrassInstances(
  footprint: PageFootprint,
  settings: GrassSettings,
  maxBlades = settings.maxBlades,
  stats?: GrassGenerationStats,
): GrassBladeInstance[] {
  const rankedInstances: { priority: number; instance: GrassBladeInstance }[] = [];
  const spacing = Math.max(0.05, settings.bladeSpacing);
  const columns = Math.max(0, Math.floor((footprint.maxX - footprint.minX) / spacing));
  const rows = Math.max(0, Math.floor((footprint.maxZ - footprint.minZ) / spacing));
  const limit = Math.max(0, Math.floor(maxBlades));
  const terrainPatchMode = grassShaderDefinition(settings.shaderMode).usesTerrainPatchPlacement;

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      if (stats) stats.generatedCandidates++;
      const gridX = Math.floor(footprint.minX / spacing) + column;
      const gridZ = Math.floor(footprint.minZ / spacing) + row;
      const baseX = footprint.minX + (column + 0.5) * spacing;
      const baseZ = footprint.minZ + (row + 0.5) * spacing;
      const x = THREE.MathUtils.clamp(
        baseX + randomSigned(gridX, gridZ, settings.seed + 101) * spacing * 0.34,
        footprint.minX + 0.001,
        footprint.maxX - 0.001,
      );
      const z = THREE.MathUtils.clamp(
        baseZ + randomSigned(gridX, gridZ, settings.seed + 211) * spacing * 0.34,
        footprint.minZ + 0.001,
        footprint.maxZ - 0.001,
      );
      const site = sampleGrassTerrainSite(x, z, settings);
      if (!acceptsGrassCandidate(settings, {
        height: site.height,
        normalY: site.normalY,
        grassWeight: site.grassMask,
        waterDepth: site.waterDepth,
        rockWeight: site.rockWeight,
        snowWeight: site.snowWeight,
        threshold: hash2(gridX, gridZ, settings.seed + 307),
      })) continue;
      const edgeFade = terrainPatchMode ? edgeFadeForCandidate(x, z, site.height, site.normalY, spacing) : 1;
      if (terrainPatchMode && edgeFade < 0.18) {
        if (stats) stats.edgeSuppressedCandidates++;
        continue;
      }
      if (stats) stats.acceptedCandidates++;

      const heightScale = Math.max(
        0.1,
        1 + randomSigned(gridX, gridZ, settings.seed + 401) * settings.bladeHeightVariation,
      );
      rankedInstances.push({
        priority: hash2(gridX, gridZ, settings.seed + 809),
        instance: {
          offset: [x, site.height + 0.02, z],
          height: settings.bladeHeight * heightScale,
          rotationY: hash2(gridX, gridZ, settings.seed + 503) * TWO_PI,
          phase: hash2(gridX, gridZ, settings.seed + 601) * TWO_PI,
          colorMix: Math.min(1, Math.pow(hash2(gridX, gridZ, settings.seed + 701), 2) + site.wetBank * 0.16 + site.sandWeight * 0.12),
          edgeFade,
          normalY: site.normalY,
          terrainNormal: site.terrainNormal,
        },
      });
    }
  }
  rankedInstances.sort((a, b) => a.priority - b.priority);
  return rankedInstances.slice(0, limit).map(({ instance }) => instance);
}

// Each blade is one or more vertical quad strips ("planes"). The base plane spans X and
// faces +Z; the crossed plane spans Z and faces +X, so a near-facing surface exists at any
// view angle (fixes edge-on thinning of a single plane). Both planes share the same vertical
// bend axis, so the vertex shader animates them identically. Per-vertex `normal` lets the
// shader light/orient each plane correctly instead of assuming a single +Z facing.
const BLADE_PLANES = {
  single: [{ axis: "x", normal: [0, 0, 1] }],
  crossed: [
    { axis: "x", normal: [0, 0, 1] },
    { axis: "z", normal: [1, 0, 0] },
  ],
} as const;

export function createBladeGeometry(
  rows: readonly (readonly [number, number])[] = BLADE_ROWS,
  crossed = false,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (const plane of crossed ? BLADE_PLANES.crossed : BLADE_PLANES.single) {
    const base = positions.length / 3;
    for (const [y, halfWidth] of rows) {
      if (plane.axis === "x") {
        positions.push(-halfWidth, y, 0, halfWidth, y, 0);
      } else {
        positions.push(0, y, -halfWidth, 0, y, halfWidth);
      }
      uvs.push(0, y, 1, y);
      normals.push(...plane.normal, ...plane.normal);
    }
    for (let row = 0; row < rows.length - 1; row++) {
      const lower = base + row * 2;
      const upper = lower + 2;
      indices.push(lower, lower + 1, upper + 1, lower, upper + 1, upper);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}

export function createGrassTuftGeometry(width = 1): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let blade = 0; blade < 3; blade++) {
    const yaw = blade * 1.92 + 0.4;
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);
    const base = positions.length / 3;
    for (const [x, y] of [[-width, 0], [width, 0], [width * 0.55, 1], [-width * 0.55, 1]] as const) {
      positions.push(x * cosYaw, y, x * sinYaw);
      const side = x < 0 ? -1 : 1;
      normals.push(
        -sinYaw * 0.62 + side * 0.38 * cosYaw,
        0.42,
        cosYaw * 0.62 + side * 0.38 * sinYaw,
      );
      uvs.push(x < 0 ? 0 : 1, y);
    }
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}

function createGrassMaterial(
  settings: GrassSettings,
  lighting: GrassLighting,
  shaderMode: GrassShaderMode,
): THREE.ShaderMaterial {
  const shader = grassShaderDefinition(shaderMode);
  const useAlphaToCoverage = shader.patchStyle === "terrain-patch" && settings.alphaToCoverage;
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBladeWidth: { value: settings.bladeWidth },
      uWindStrength: { value: settings.windStrength },
      uWindSpeed: { value: settings.windSpeed },
      uNearDistance: { value: settings.distance * V2_NEAR_DISTANCE_FRACTION },
      uMidDistance: { value: settings.distance * V2_MID_DISTANCE_FRACTION },
      uFadeDistance: { value: grassFadeDistance(settings) },
      uLight: { value: lighting.light.clone() },
      uSunColor: { value: lighting.sunColor.clone() },
      uSkyLight: { value: lighting.skyLight.clone() },
      uGroundLight: { value: lighting.groundLight.clone() },
      uAlphaToCoverage: { value: useAlphaToCoverage ? 1 : 0 },
    },
    vertexShader: shader.vertexShader,
    fragmentShader: shader.fragmentShader,
    side: THREE.DoubleSide,
    // Both modes stay opaque (no alpha blending => depth-write + early-Z, no overdraw
    // blow-up). terrain-patch-v2 fades either via hardware alpha-to-coverage (smooth, needs
    // an MSAA target) or the ordered-dither cutout fallback; classic is fully solid.
    transparent: false,
    depthWrite: true,
    alphaToCoverage: useAlphaToCoverage,
    toneMapped: true,
  });
}

function cloneLighting(lighting: GrassLighting): GrassLighting {
  return {
    light: lighting.light.clone(),
    sunColor: lighting.sunColor.clone(),
    skyLight: lighting.skyLight.clone(),
    groundLight: lighting.groundLight.clone(),
  };
}

export class GrassSystem {
  private readonly scene: THREE.Scene;
  private readonly nodes: ClodPageNode[];
  private readonly worldCells: number;
  private readonly root = new THREE.Group();
  private readonly classicBladeGeometry = createBladeGeometry();
  private readonly terrainPatchNearGeometry = createBladeGeometry(V2_NEAR_BLADE_ROWS);
  private readonly terrainPatchNearCrossedGeometry = createBladeGeometry(V2_NEAR_BLADE_ROWS, true);
  private readonly terrainPatchMidGeometry = createBladeGeometry(V2_MID_BLADE_ROWS);
  private readonly terrainPatchFarGeometry = createGrassTuftGeometry(1.25);
  private readonly terrainPatchSuperGeometry = createGrassTuftGeometry(1.85);
  private readonly ringNearGeometry = createBladeGeometry(V2_NEAR_BLADE_ROWS, true);
  private readonly ringMidGeometry = createBladeGeometry(V2_MID_BLADE_ROWS, true);
  private readonly ringFarGeometry = createGrassTuftGeometry(1.15);
  private readonly ringSuperGeometry = createGrassTuftGeometry(1.85);
  private readonly materials = new Map<GrassShaderMode, THREE.ShaderMaterial>();
  private readonly supportsRing: boolean;
  private readonly gpuDevice: GPUDevice | null;
  private readonly gpuBackend: GrassWebGpuBackendAccess | null;
  private readonly gpuRingUnsupportedReason: string | null;
  private gpuRingCompute: GrassGpuRingCompute | null = null;
  private gpuRingInit: Promise<void> | null = null;
  private gpuRingKey = "";
  private gpuRingDraw: GrassGpuRingDrawResources | null = null;
  private gpuRingStats: GrassGpuRingStats = {
    status: "disabled",
    candidateCount: 0,
    generatedCandidates: 0,
    acceptedCandidates: 0,
    counts: { near: 0, mid: 0, far: 0, super: 0 },
    dispatchMs: null,
    readbackMs: null,
    skippedDispatches: 0,
  };
  private injectedMaterial: GrassMaterialHandle | null;
  private readonly injectedMaterialFactory: GrassMaterialFactory | null;
  private readonly injectedGeometryBuilder: GrassGeometryBuilder | null;
  private currentLighting: GrassLighting;
  private settings: GrassSettings;
  private patches: GrassPatch[] = [];
  private patchesDirty = true;
  private ringMeshes: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>[] = [];
  private ringDirty = true;
  private ringBladeCount = 0;
  private ringTierCounts: Record<GrassTier, number> = { near: 0, mid: 0, far: 0, super: 0 };
  private ringCenterCellX = Number.POSITIVE_INFINITY;
  private ringCenterCellZ = Number.POSITIVE_INFINITY;
  private readonly lastRefreshCenter = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0);
  private bladeCount = 0;
  private generationStats: GrassGenerationStats = {
    generatedCandidates: 0,
    acceptedCandidates: 0,
    edgeSuppressedCandidates: 0,
  };
  private stats: GrassStats = {
    mode: DEFAULT_GRASS_SHADER_MODE,
    blades: 0,
    patches: 0,
    visiblePatches: 0,
    culledPatches: 0,
    nearPatches: 0,
    midPatches: 0,
    coveragePatches: 0,
    superPatches: 0,
    generatedCandidates: 0,
    acceptedCandidates: 0,
    edgeSuppressedCandidates: 0,
    midBladeCount: 0,
    gpuRingStatus: "disabled",
    gpuRingCandidateCount: 0,
    gpuRingVisibleNear: 0,
    gpuRingVisibleMid: 0,
    gpuRingVisibleFar: 0,
    gpuRingVisibleSuper: 0,
    gpuRingDispatchMs: null,
    gpuRingReadbackMs: null,
  };
  private readonly lastCenter: THREE.Vector3;

  constructor(options: GrassSystemOptions) {
    this.scene = options.scene;
    this.nodes = options.nodes
      .filter((node) => node.level === 0)
      .sort((a, b) => a.footprint.minZ - b.footprint.minZ || a.footprint.minX - b.footprint.minX);
    this.worldCells = options.worldCells;
    this.settings = { ...options.settings };
    this.supportsRing = options.supportsRing === true;
    this.gpuDevice = options.gpuDevice ?? null;
    this.gpuBackend = options.gpuBackend ?? null;
    const computeUnsupportedReason = this.gpuDevice
      ? grassGpuRingComputeUnsupportedReason(this.gpuDevice)
      : null;
    this.gpuRingUnsupportedReason = computeUnsupportedReason ?? grassGpuRingDrawUnsupportedReason();
    this.currentLighting = cloneLighting(options.lighting);
    this.injectedMaterialFactory = options.createMaterial ?? null;
    this.injectedMaterial = options.material ?? null;
    this.injectedGeometryBuilder = options.buildGeometry ?? null;
    if (this.injectedMaterialFactory) this.replaceInjectedMaterial();
    if (!this.injectedMaterial) {
      for (const mode of GRASS_SHADER_MODES) {
        this.materials.set(mode, createGrassMaterial(this.settings, options.lighting, mode));
      }
    }
    this.lastCenter = new THREE.Vector3(this.worldCells * 0.5, 0, this.worldCells * 0.5);
    this.root.name = "grass";
    this.scene.add(this.root);
    this.root.visible = this.settings.enabled;
    if (this.settings.enabled) this.rebuild();
  }

  setEnabled(enabled: boolean): void {
    const wasEnabled = this.settings.enabled;
    this.settings.enabled = enabled;
    this.root.visible = enabled;
    if (enabled && !wasEnabled) {
      if (this.isRingMode()) {
        this.updateGpuRingCounters(this.lastCenter);
        this.refreshRingForCenter(this.lastCenter, true);
      }
      else if (this.patches.length === 0) this.refreshForCenter(this.lastCenter);
    }
  }

  updateSettings(settings: Partial<GrassSettings>): void {
    const wasRing = this.isRingMode();
    const previousMode = this.settings.shaderMode;
    Object.assign(this.settings, settings);
    const nowRing = this.isRingMode();
    if (wasRing !== nowRing) {
      this.clearPatches();
      this.clearRing();
      this.clearGpuRingCompute();
    }
    if (this.injectedMaterialFactory && previousMode !== this.settings.shaderMode) {
      this.replaceInjectedMaterial();
    }
    this.updateMaterialUniforms();
    this.patchesDirty = true;
    this.ringDirty = true;
    this.setEnabled(this.settings.enabled);
  }

  updateLighting(lighting: GrassLighting): void {
    this.currentLighting = cloneLighting(lighting);
    if (this.injectedMaterial) {
      this.injectedMaterial.updateLighting?.(lighting);
      return;
    }
    for (const material of this.materials.values()) {
      material.uniforms.uLight.value.copy(lighting.light);
      material.uniforms.uSunColor.value.copy(lighting.sunColor);
      material.uniforms.uSkyLight.value.copy(lighting.skyLight);
      material.uniforms.uGroundLight.value.copy(lighting.groundLight);
    }
  }

  update(timeSeconds: number, center: THREE.Vector3): void {
    if (this.injectedMaterial) {
      this.injectedMaterial.setTime?.(timeSeconds);
      this.injectedMaterial.setFadeCenter?.(center.x, center.z);
    } else {
      for (const material of this.materials.values()) {
        material.uniforms.uTime.value = timeSeconds;
      }
    }
    this.lastCenter.copy(center);
    if (!this.settings.enabled) {
      this.updateStats();
      return;
    }
    if (this.isRingMode()) {
      this.updateGpuRingCounters(center);
      this.refreshRingForCenter(center);
      return;
    }
    if (this.patchesDirty || this.lastRefreshCenter.distanceTo(center) >= PATCH_REFRESH_DISTANCE) {
      this.refreshForCenter(center);
    }
  }

  rebuild(): void {
    this.clearPatches();
    this.clearRing();
    this.clearGpuRingCompute();
    if (this.settings.enabled) {
      if (this.isRingMode()) {
        this.updateGpuRingCounters(this.lastCenter);
        this.refreshRingForCenter(this.lastCenter, true);
      }
      else this.refreshForCenter(this.lastCenter);
    }
    this.root.visible = this.settings.enabled;
  }

  /** Regenerate grass for edited LOD0 pages so blades track the current surface. */
  rebuildNodePatches(nodeIds: Iterable<string>): void {
    const ids = new Set(nodeIds);
    if (ids.size === 0) return;
    if (this.isRingMode()) {
      this.ringDirty = true;
      this.clearGpuRingCompute();
      this.updateGpuRingCounters(this.lastCenter);
      this.refreshRingForCenter(this.lastCenter, true);
      return;
    }
    const retained: GrassPatch[] = [];
    for (const patch of this.patches) {
      if (ids.has(patch.nodeId)) {
        this.removePatch(patch);
        this.bladeCount -= patch.bladeCount;
      } else {
        retained.push(patch);
      }
    }
    this.patches = retained;
    this.refreshForCenter(this.lastCenter);
  }

  dispose(): void {
    this.clearPatches();
    this.clearRing();
    this.root.clear();
    this.scene.remove(this.root);
    this.classicBladeGeometry.dispose();
    this.terrainPatchNearGeometry.dispose();
    this.terrainPatchNearCrossedGeometry.dispose();
    this.terrainPatchMidGeometry.dispose();
    this.terrainPatchFarGeometry.dispose();
    this.terrainPatchSuperGeometry.dispose();
    this.ringNearGeometry.dispose();
    this.ringMidGeometry.dispose();
    this.ringFarGeometry.dispose();
    this.ringSuperGeometry.dispose();
    this.clearGpuRingCompute();
    for (const material of this.materials.values()) material.dispose();
    this.injectedMaterial?.dispose?.();
  }

  getBladeCount(): number {
    if (this.isRingMode()) return this.ringBladeCount;
    return this.bladeCount;
  }

  getStats(): GrassStats {
    this.updateStats();
    return { ...this.stats };
  }

  private clearPatches(): void {
    for (const patch of this.patches) {
      this.removePatch(patch);
    }
    this.patches = [];
    this.bladeCount = 0;
    this.generationStats = {
      generatedCandidates: 0,
      acceptedCandidates: 0,
      edgeSuppressedCandidates: 0,
    };
    this.updateStats();
  }

  private clearRing(): void {
    for (const mesh of this.ringMeshes) {
      this.root.remove(mesh);
      mesh.geometry.dispose();
    }
    this.ringMeshes = [];
    this.gpuRingDraw = null;
    this.ringBladeCount = 0;
    this.ringTierCounts = { near: 0, mid: 0, far: 0, super: 0 };
    this.ringCenterCellX = Number.POSITIVE_INFINITY;
    this.ringCenterCellZ = Number.POSITIVE_INFINITY;
    this.ringDirty = true;
    this.updateStats();
  }

  private clearGpuRingCompute(): void {
    this.gpuRingCompute?.destroy();
    this.gpuRingCompute = null;
    this.gpuRingInit = null;
    this.gpuRingKey = "";
    this.gpuRingStats = {
      status: this.gpuDevice ? "idle" : "disabled",
      candidateCount: 0,
      generatedCandidates: 0,
      acceptedCandidates: 0,
      counts: { near: 0, mid: 0, far: 0, super: 0 },
      dispatchMs: null,
      readbackMs: null,
      skippedDispatches: 0,
    };
  }

  private isRingMode(): boolean {
    return this.supportsRing && this.settings.shaderMode === "webgpu-ring-v1";
  }

  private updateGpuRingCounters(center: THREE.Vector3): void {
    if (!this.gpuDevice || !this.gpuBackend || !this.isRingMode()) {
      this.gpuRingStats = {
        ...this.gpuRingStats,
        status: "disabled",
      };
      return;
    }
    if (this.gpuRingUnsupportedReason) {
      this.gpuRingStats = {
        ...this.gpuRingStats,
        status: "disabled",
        reason: this.gpuRingUnsupportedReason,
      };
      return;
    }

    this.ensureGpuRingCompute();
    if (!this.gpuRingCompute) return;
    this.gpuRingCompute.dispatch({
      centerX: center.x,
      centerZ: center.z,
      bands: grassRingBands(this.settings),
    }, {
      near: this.indexCountFor(this.ringNearGeometry),
      mid: this.indexCountFor(this.ringMidGeometry),
      far: this.indexCountFor(this.ringFarGeometry),
      super: this.indexCountFor(this.ringSuperGeometry),
    });
    this.gpuRingStats = this.gpuRingCompute.stats(this.settings.enabled);
    this.ringTierCounts = {
      near: this.gpuRingStats.counts.near,
      mid: this.gpuRingStats.counts.mid,
      far: this.gpuRingStats.counts.far,
      super: this.gpuRingStats.counts.super,
    };
    this.ringBladeCount = this.ringTierCounts.near + this.ringTierCounts.mid + this.ringTierCounts.far + this.ringTierCounts.super;
  }

  private ensureGpuRingCompute(): void {
    if (!this.gpuDevice || !this.gpuBackend || !this.isRingMode()) return;
    const key = grassGpuCandidateKey(this.settings, this.worldCells);
    if (this.gpuRingCompute && this.gpuRingKey === key) {
      this.gpuRingStats = this.gpuRingCompute.stats(this.settings.enabled);
      return;
    }
    if (this.gpuRingInit && this.gpuRingKey === key) return;

    this.clearGpuRingCompute();
    this.clearRing();
    this.gpuRingKey = key;
    const candidates = buildGrassGpuCandidateBuffer(this.settings, this.worldCells);
    this.gpuRingDraw = this.createGpuRingDrawResources(candidates.count);
    this.ringMeshes = Object.values(this.gpuRingDraw.tiers).map((tier) => tier.mesh);
    for (const mesh of this.ringMeshes) this.root.add(mesh);
    this.gpuRingStats = {
      status: "initializing",
      candidateCount: candidates.count,
      generatedCandidates: candidates.generatedCandidates,
      acceptedCandidates: candidates.acceptedCandidates,
      counts: { near: 0, mid: 0, far: 0, super: 0 },
      dispatchMs: null,
      readbackMs: null,
      skippedDispatches: 0,
    };
    const initKey = key;
    this.gpuRingInit = GrassGpuRingCompute.create(this.gpuDevice, candidates, this.gpuRingDraw.outputBuffers)
      .then((compute) => {
        if (this.gpuRingKey !== initKey) {
          compute.destroy();
          return;
        }
        this.gpuRingCompute = compute;
        this.gpuRingStats = compute.stats(this.settings.enabled);
      })
      .catch((error) => {
        if (this.gpuRingKey !== initKey) return;
        this.gpuRingStats = {
          ...this.gpuRingStats,
          status: "failed",
          reason: error instanceof Error ? error.message : String(error),
        };
      })
      .finally(() => {
        if (this.gpuRingKey === initKey) this.gpuRingInit = null;
      });
  }

  private indexCountFor(geometry: THREE.BufferGeometry): number {
    return geometry.getIndex()?.count ?? geometry.getAttribute("position")?.count ?? 0;
  }

  private createGpuRingDrawResources(candidateCount: number): GrassGpuRingDrawResources {
    if (!this.gpuBackend) throw new Error("Cannot create WebGPU grass draw resources without a backend");
    const count = Math.max(1, candidateCount);
    const sharedInstanceCount = count * 4;
    const indirect = new StorageBufferAttribute(new Uint32Array(4 * 5), 5);
    indirect.name = "grass-ring-indirect";
    this.gpuBackend.createIndirectStorageAttribute(indirect);
    const sharedAttributes: GrassGpuSharedDrawAttributes = {
      offset: this.createStorageInstancedAttribute("shared-offset", sharedInstanceCount),
      packed0: this.createStorageInstancedAttribute("shared-packed0", sharedInstanceCount),
      packed1: this.createStorageInstancedAttribute("shared-packed1", sharedInstanceCount),
      terrainNormal: this.createStorageInstancedAttribute("shared-terrain-normal", sharedInstanceCount),
    };

    const tiers = {
      near: this.createGpuRingTierDraw("near", count, this.ringNearGeometry, indirect, 0, sharedAttributes),
      mid: this.createGpuRingTierDraw("mid", count, this.ringMidGeometry, indirect, 5 * Uint32Array.BYTES_PER_ELEMENT, sharedAttributes),
      far: this.createGpuRingTierDraw("far", count, this.ringFarGeometry, indirect, 10 * Uint32Array.BYTES_PER_ELEMENT, sharedAttributes),
      super: this.createGpuRingTierDraw("super", count, this.ringSuperGeometry, indirect, 15 * Uint32Array.BYTES_PER_ELEMENT, sharedAttributes),
    } satisfies Record<GrassTier, GrassGpuTierDrawResources>;

    return {
      tiers,
      indirect,
      outputBuffers: {
        near: this.gpuBuffersForTier(sharedAttributes),
        mid: this.gpuBuffersForTier(sharedAttributes),
        far: this.gpuBuffersForTier(sharedAttributes),
        super: this.gpuBuffersForTier(sharedAttributes),
        indirectArgs: this.gpuBufferForAttribute(indirect),
      },
    };
  }

  private createGpuRingTierDraw(
    tier: GrassTier,
    count: number,
    bladeGeometry: THREE.BufferGeometry,
    indirect: StorageBufferAttribute,
    indirectOffset: number,
    sharedAttributes: GrassGpuSharedDrawAttributes,
  ): GrassGpuTierDrawResources {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("position", bladeGeometry.getAttribute("position"));
    geometry.setAttribute("uv", bladeGeometry.getAttribute("uv"));
    geometry.setAttribute("normal", bladeGeometry.getAttribute("normal"));
    geometry.setIndex(bladeGeometry.getIndex());
    const { offset, packed0, packed1, terrainNormal } = sharedAttributes;
    geometry.setAttribute("aOffset", offset);
    geometry.setAttribute("aPacked0", packed0);
    geometry.setAttribute("aPacked1", packed1);
    geometry.setAttribute("aTerrainNormal", terrainNormal);
    geometry.instanceCount = count;
    this.setGpuRingIndirect(geometry, indirect, indirectOffset);
    geometry.boundingBox = new THREE.Box3(
      new THREE.Vector3(-1, -1, -1),
      new THREE.Vector3(this.worldCells + 1, 256, this.worldCells + 1),
    );
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
    const mesh = new THREE.Mesh(geometry, this.materialFor(this.settings.shaderMode));
    mesh.name = `grass-ring-gpu-${tier}`;
    mesh.frustumCulled = false;
    return { mesh, offset, packed0, packed1, terrainNormal };
  }

  private createStorageInstancedAttribute(name: string, count: number): StorageInstancedBufferAttribute {
    if (!this.gpuBackend) throw new Error("Cannot create WebGPU grass storage attribute without a backend");
    const attribute = new StorageInstancedBufferAttribute(count, 4);
    attribute.name = `grass-ring-${name}`;
    this.gpuBackend.createStorageAttribute(attribute);
    return attribute;
  }

  private setGpuRingIndirect(
    geometry: THREE.InstancedBufferGeometry,
    indirect: StorageBufferAttribute,
    indirectOffset: number,
  ): void {
    const indirectGeometry = geometry as IndirectInstancedBufferGeometry;
    if (!indirectGeometry.setIndirect) {
      throw new Error(grassGpuRingDrawUnsupportedReason() ?? "Missing WebGPU indirect geometry support");
    }
    indirectGeometry.setIndirect(indirect, indirectOffset);
  }

  private gpuBuffersForTier(tier: GrassGpuSharedDrawAttributes): GrassGpuTierOutputBuffers {
    return {
      offset: this.gpuBufferForAttribute(tier.offset),
      packed0: this.gpuBufferForAttribute(tier.packed0),
      packed1: this.gpuBufferForAttribute(tier.packed1),
      terrainNormal: this.gpuBufferForAttribute(tier.terrainNormal),
    };
  }

  private gpuBufferForAttribute(attribute: THREE.BufferAttribute): GPUBuffer {
    if (!this.gpuBackend) throw new Error("Cannot read WebGPU grass buffer without a backend");
    const buffer = this.gpuBackend.get(attribute).buffer;
    if (!buffer) throw new Error(`Missing GPU buffer for ${attribute.name || "grass attribute"}`);
    return buffer;
  }

  private refreshRingForCenter(center: THREE.Vector3, force = false): void {
    if (this.gpuRingDraw) {
      this.updateStats();
      return;
    }
    const radius = Math.max(0, Math.min(this.settings.distance, RING_MAX_RADIUS));
    const cellSize = ringCellSize(this.settings, radius);
    const centerCellX = Math.floor(center.x / cellSize);
    const centerCellZ = Math.floor(center.z / cellSize);
    const cellDelta = Math.max(
      Math.abs(centerCellX - this.ringCenterCellX),
      Math.abs(centerCellZ - this.ringCenterCellZ),
    );
    if (!force && !this.ringDirty && cellDelta < RING_REFRESH_CELLS) {
      this.updateStats();
      return;
    }

    const ring = generateGrassRingInstances(center, this.settings, this.worldCells);
    this.clearRing();
    this.generationStats = ring.stats;
    this.ringCenterCellX = ring.centerCellX;
    this.ringCenterCellZ = ring.centerCellZ;
    this.ringDirty = false;
    this.addRingTier("near", ring.near, this.ringNearGeometry);
    this.addRingTier("mid", ring.mid, this.ringMidGeometry);
    this.addRingTier("far", ring.far, this.ringFarGeometry);
    this.addRingTier("super", ring.super, this.ringSuperGeometry);
    this.ringBladeCount = ring.near.length + ring.mid.length + ring.far.length + ring.super.length;
    this.ringTierCounts = {
      near: ring.near.length,
      mid: ring.mid.length,
      far: ring.far.length,
      super: ring.super.length,
    };
    this.updateStats();
  }

  private addRingTier(
    tier: GrassTier,
    instances: GrassBladeInstance[],
    bladeGeometry: THREE.BufferGeometry,
  ): void {
    if (instances.length === 0) return;
    const geometry = this.injectedGeometryBuilder
      ? this.injectedGeometryBuilder(instances, {
          mode: this.settings.shaderMode,
          tier,
          crossed: true,
        })
      : new THREE.InstancedBufferGeometry();
    if (!this.injectedGeometryBuilder) {
      this.populateGeometry(geometry, bladeGeometry, this.instancesFootprint(instances), instances);
    }
    const mesh = new THREE.Mesh(geometry, this.materialFor(this.settings.shaderMode));
    mesh.name = `grass-ring-${tier}`;
    mesh.frustumCulled = true;
    this.ringMeshes.push(mesh);
    this.root.add(mesh);
  }

  private instancesFootprint(instances: readonly GrassBladeInstance[]): PageFootprint {
    let minX = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (const instance of instances) {
      minX = Math.min(minX, instance.offset[0]);
      minZ = Math.min(minZ, instance.offset[2]);
      maxX = Math.max(maxX, instance.offset[0]);
      maxZ = Math.max(maxZ, instance.offset[2]);
    }
    return { minX, minZ, maxX, maxZ };
  }

  private refreshForCenter(center: THREE.Vector3): void {
    // refreshPatches builds at most MAX_NEW_PATCHES_PER_REFRESH new patches and returns true if it
    // deferred more; keep patchesDirty set so update() finishes them over the next frames instead
    // of scattering every newly-in-range patch in one frame (the walk stutter).
    const deferred = this.refreshPatches(center);
    for (const patch of this.patches) {
      const distance = Math.hypot(center.x - patch.centerX, center.z - patch.centerZ);
      this.updatePatchVisibility(patch, distance);
    }
    this.lastRefreshCenter.copy(center);
    this.patchesDirty = deferred;
    this.updateStats();
  }

  /** Returns true if it hit the per-frame patch budget and left more nodes to build later. */
  private refreshPatches(center: THREE.Vector3): boolean {
    const nearbyNodes = this.nodes.filter((node) => {
      const footprint = node.footprint;
      const centerX = (footprint.minX + footprint.maxX) * 0.5;
      const centerZ = (footprint.minZ + footprint.maxZ) * 0.5;
      const radius = Math.hypot(footprint.maxX - footprint.minX, footprint.maxZ - footprint.minZ) * 0.5;
      return Math.hypot(center.x - centerX, center.z - centerZ) <= this.settings.distance + radius;
    });
    const nearbyIds = new Set(nearbyNodes.map((node) => node.id));
    const retainedPatches: GrassPatch[] = [];
    for (const patch of this.patches) {
      if (nearbyIds.has(patch.nodeId)) {
        retainedPatches.push(patch);
      } else {
        this.removePatch(patch);
        this.bladeCount -= patch.bladeCount;
      }
    }
    this.patches = retainedPatches;

    const retainedIds = new Set(this.patches.map((patch) => patch.nodeId));
    const newNodes = nearbyNodes.filter((node) => !retainedIds.has(node.id));
    let remainingBudget = Math.max(0, Math.floor(this.settings.maxBlades) - this.bladeCount);
    let built = 0;
    for (let index = 0; index < newNodes.length && remainingBudget > 0; index++) {
      // Each createPatch scatters blades + builds an InstancedBufferGeometry. Building every
      // newly-in-range node in one frame is the walk stutter; cap per frame and defer the rest.
      if (built >= MAX_NEW_PATCHES_PER_REFRESH) return true;
      const node = newNodes[index];
      const source = node.footprint;
      const footprint: PageFootprint = {
        minX: THREE.MathUtils.clamp(source.minX, 0, this.worldCells),
        minZ: THREE.MathUtils.clamp(source.minZ, 0, this.worldCells),
        maxX: THREE.MathUtils.clamp(source.maxX, 0, this.worldCells),
        maxZ: THREE.MathUtils.clamp(source.maxZ, 0, this.worldCells),
      };
      const remainingNodes = newNodes.length - index;
      const patchBudget = Math.ceil(remainingBudget / remainingNodes);
      const instances = generateGrassInstances(footprint, this.settings, patchBudget, this.generationStats);
      if (instances.length === 0) continue;
      const patch = this.createPatch(node.id, footprint, instances);
      this.patches.push(patch);
      for (const mesh of patch.meshes) this.root.add(mesh);
      this.bladeCount += patch.bladeCount;
      remainingBudget -= patch.bladeCount;
      built++;
    }
    return false;
  }

  private createPatch(nodeId: string, footprint: PageFootprint, instances: GrassBladeInstance[]): GrassPatch {
    const shader = grassShaderDefinition(this.settings.shaderMode);
    if (shader.patchStyle === "terrain-patch") {
      return this.createTerrainPatch(nodeId, footprint, instances);
    }
    const geometry = this.injectedGeometryBuilder
      ? this.injectedGeometryBuilder(instances, { mode: this.settings.shaderMode, tier: "near" })
      : new THREE.InstancedBufferGeometry();
    if (!this.injectedGeometryBuilder) {
      this.populateGeometry(geometry, this.classicBladeGeometry, footprint, instances);
    }

    const centerX = (footprint.minX + footprint.maxX) * 0.5;
    const centerZ = (footprint.minZ + footprint.maxZ) * 0.5;
    const radius = Math.hypot(footprint.maxX - footprint.minX, footprint.maxZ - footprint.minZ) * 0.5;
    return {
      nodeId,
      meshes: [new THREE.Mesh(geometry, this.materialFor(this.settings.shaderMode))],
      centerX,
      centerZ,
      radius,
      bladeCount: instances.length,
      midBladeCount: 0,
      visibleTier: "hidden",
    };
  }

  private createTerrainPatch(nodeId: string, footprint: PageFootprint, instances: GrassBladeInstance[]): GrassPatch {
    const nearBlade = this.settings.nearCrossedQuads
      ? this.terrainPatchNearCrossedGeometry
      : this.terrainPatchNearGeometry;
    const nearGeometry = this.injectedGeometryBuilder
      ? this.injectedGeometryBuilder(instances, {
          mode: this.settings.shaderMode,
          tier: "near",
          crossed: this.settings.nearCrossedQuads,
        })
      : new THREE.InstancedBufferGeometry();
    if (!this.injectedGeometryBuilder) {
      this.populateGeometry(nearGeometry, nearBlade, footprint, instances);
    }

    const midCount = Math.max(1, Math.floor(instances.length * V2_MID_INSTANCE_FRACTION));
    const midInstances = instances.slice(0, midCount).map((instance) => ({
      ...instance,
      height: instance.height * 1.55,
      edgeFade: Math.min(1, instance.edgeFade * 1.15),
      widthScale: (instance.widthScale ?? 1) * 1.25,
    }));
    const midGeometry = this.injectedGeometryBuilder
      ? this.injectedGeometryBuilder(midInstances, { mode: this.settings.shaderMode, tier: "mid" })
      : new THREE.InstancedBufferGeometry();
    if (!this.injectedGeometryBuilder) {
      this.populateGeometry(midGeometry, this.terrainPatchMidGeometry, footprint, midInstances);
    }

    const farCount = Math.max(1, Math.floor(instances.length * V2_FAR_INSTANCE_FRACTION));
    const farInstances = instances.slice(0, farCount).map((instance) => ({
      ...instance,
      height: instance.height * 1.9,
      edgeFade: Math.min(1, instance.edgeFade * 1.25),
      widthScale: (instance.widthScale ?? 1) * 2.6,
    }));
    const farGeometry = this.injectedGeometryBuilder
      ? this.injectedGeometryBuilder(farInstances, {
          mode: this.settings.shaderMode,
          tier: "far",
          crossed: true,
        })
      : new THREE.InstancedBufferGeometry();
    if (!this.injectedGeometryBuilder) {
      this.populateGeometry(farGeometry, this.terrainPatchFarGeometry, footprint, farInstances);
    }

    const superCount = Math.max(1, Math.floor(instances.length * V2_SUPER_INSTANCE_FRACTION));
    const superInstances = instances.slice(0, superCount).map((instance) => ({
      ...instance,
      height: instance.height * 2.35,
      edgeFade: Math.min(1, instance.edgeFade * 1.35),
      widthScale: (instance.widthScale ?? 1) * 3.8,
    }));
    const superGeometry = this.injectedGeometryBuilder
      ? this.injectedGeometryBuilder(superInstances, {
          mode: this.settings.shaderMode,
          tier: "super",
          crossed: true,
        })
      : new THREE.InstancedBufferGeometry();
    if (!this.injectedGeometryBuilder) {
      this.populateGeometry(superGeometry, this.terrainPatchSuperGeometry, footprint, superInstances);
    }

    const centerX = (footprint.minX + footprint.maxX) * 0.5;
    const centerZ = (footprint.minZ + footprint.maxZ) * 0.5;
    const radius = Math.hypot(footprint.maxX - footprint.minX, footprint.maxZ - footprint.minZ) * 0.5;
    const material = this.materialFor(this.settings.shaderMode);
    const nearMesh = new THREE.Mesh(nearGeometry, material);
    const midMesh = new THREE.Mesh(midGeometry, material);
    const farMesh = new THREE.Mesh(farGeometry, material);
    const superMesh = new THREE.Mesh(superGeometry, material);
    return {
      nodeId,
      meshes: [nearMesh, midMesh, farMesh, superMesh],
      centerX,
      centerZ,
      radius,
      bladeCount: instances.length,
      midBladeCount: midInstances.length + farInstances.length + superInstances.length,
      visibleTier: "hidden",
    };
  }

  private populateGeometry(
    geometry: THREE.InstancedBufferGeometry,
    bladeGeometry: THREE.BufferGeometry,
    footprint: PageFootprint,
    instances: GrassBladeInstance[],
  ): void {
    geometry.setAttribute("position", bladeGeometry.getAttribute("position"));
    geometry.setAttribute("uv", bladeGeometry.getAttribute("uv"));
    geometry.setAttribute("normal", bladeGeometry.getAttribute("normal"));
    geometry.setIndex(bladeGeometry.getIndex());

    const offsets = new Float32Array(instances.length * 3);
    const heights = new Float32Array(instances.length);
    const rotations = new Float32Array(instances.length);
    const phases = new Float32Array(instances.length);
    const colorMixes = new Float32Array(instances.length);
    const edgeFades = new Float32Array(instances.length);
    const normalYs = new Float32Array(instances.length);
    const terrainNormals = new Float32Array(instances.length * 3);
    const widthScales = new Float32Array(instances.length);
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < instances.length; index++) {
      const instance = instances[index];
      offsets.set(instance.offset, index * 3);
      heights[index] = instance.height;
      rotations[index] = instance.rotationY;
      phases[index] = instance.phase;
      colorMixes[index] = instance.colorMix;
      edgeFades[index] = instance.edgeFade;
      normalYs[index] = instance.normalY;
      terrainNormals.set(instance.terrainNormal, index * 3);
      widthScales[index] = instance.widthScale ?? 1;
      minY = Math.min(minY, instance.offset[1]);
      maxY = Math.max(maxY, instance.offset[1] + instance.height);
    }
    geometry.setAttribute("aOffset", new THREE.InstancedBufferAttribute(offsets, 3));
    geometry.setAttribute("aHeight", new THREE.InstancedBufferAttribute(heights, 1));
    geometry.setAttribute("aRotY", new THREE.InstancedBufferAttribute(rotations, 1));
    geometry.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phases, 1));
    geometry.setAttribute("aColorMix", new THREE.InstancedBufferAttribute(colorMixes, 1));
    geometry.setAttribute("aEdgeFade", new THREE.InstancedBufferAttribute(edgeFades, 1));
    geometry.setAttribute("aNormalY", new THREE.InstancedBufferAttribute(normalYs, 1));
    geometry.setAttribute("aTerrainNormal", new THREE.InstancedBufferAttribute(terrainNormals, 3));
    geometry.setAttribute("aWidthScale", new THREE.InstancedBufferAttribute(widthScales, 1));
    geometry.instanceCount = instances.length;

    const margin = this.settings.bladeWidth
      + this.settings.bladeHeight * (1 + this.settings.bladeHeightVariation) * this.settings.windStrength * 2;
    geometry.boundingBox = new THREE.Box3(
      new THREE.Vector3(footprint.minX - margin, minY, footprint.minZ - margin),
      new THREE.Vector3(footprint.maxX + margin, maxY, footprint.maxZ + margin),
    );
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
  }

  private updateMaterialUniforms(): void {
    if (this.injectedMaterial) {
      this.injectedMaterial.updateSettings?.(this.settings);
      return;
    }
    for (const [mode, material] of this.materials) {
      material.uniforms.uBladeWidth.value = this.settings.bladeWidth;
      material.uniforms.uWindStrength.value = this.settings.windStrength;
      material.uniforms.uWindSpeed.value = this.settings.windSpeed;
      material.uniforms.uNearDistance.value = this.settings.distance * V2_NEAR_DISTANCE_FRACTION;
      material.uniforms.uMidDistance.value = this.settings.distance * V2_MID_DISTANCE_FRACTION;
      material.uniforms.uFadeDistance.value = grassFadeDistance(this.settings);
      // Toggling alpha-to-coverage only flips a material flag + uniform (no recompile/rebuild).
      const useAlphaToCoverage =
        grassShaderDefinition(mode).patchStyle === "terrain-patch" && this.settings.alphaToCoverage;
      material.alphaToCoverage = useAlphaToCoverage;
      material.uniforms.uAlphaToCoverage.value = useAlphaToCoverage ? 1 : 0;
    }
  }

  private updatePatchVisibility(patch: GrassPatch, distance: number): void {
    if (grassShaderDefinition(this.settings.shaderMode).patchStyle !== "terrain-patch") {
      const visible = distance <= this.settings.distance + patch.radius;
      patch.meshes[0].visible = visible;
      patch.visibleTier = visible ? "near" : "hidden";
      return;
    }

    const nearDistance = this.settings.distance * V2_NEAR_DISTANCE_FRACTION + patch.radius;
    const midDistance = this.settings.distance * V2_MID_DISTANCE_FRACTION + patch.radius;
    const farDistance = this.settings.distance * RING_FAR_DISTANCE_FRACTION + patch.radius;
    const coverageDistance = this.settings.distance + patch.radius;
    patch.meshes[0].visible = distance <= nearDistance;
    patch.meshes[1].visible = distance > nearDistance && distance <= midDistance;
    patch.meshes[2].visible = distance > midDistance && distance <= farDistance;
    patch.meshes[3].visible = distance > farDistance && distance <= coverageDistance;
    patch.visibleTier = patch.meshes[0].visible
      ? "near"
      : patch.meshes[1].visible
        ? "mid"
        : patch.meshes[2].visible ? "far" : patch.meshes[3].visible ? "super" : "hidden";
  }

  private removePatch(patch: GrassPatch): void {
    for (const mesh of patch.meshes) {
      this.root.remove(mesh);
      mesh.geometry.dispose();
    }
  }

  private materialFor(mode: GrassShaderMode): THREE.Material {
    if (this.injectedMaterial) return this.injectedMaterial.material;
    const material = this.materials.get(mode);
    if (!material) throw new Error(`Missing grass material for shader mode: ${mode}`);
    return material;
  }

  private replaceInjectedMaterial(): void {
    if (!this.injectedMaterialFactory) return;
    const previous = this.injectedMaterial;
    this.injectedMaterial = this.injectedMaterialFactory(this.settings, this.currentLighting);
    for (const patch of this.patches) {
      for (const mesh of patch.meshes) mesh.material = this.injectedMaterial.material;
    }
    previous?.dispose?.();
  }

  private updateStats(): void {
    const gpu = this.gpuRingStats;
    if (this.isRingMode()) {
      if (this.gpuRingCompute) this.gpuRingStats = this.gpuRingCompute.stats(this.settings.enabled);
      const ringGpu = this.gpuRingStats;
      const visiblePatches = this.ringMeshes.filter((mesh) => mesh.visible).length;
      this.stats = {
        mode: this.settings.shaderMode,
        blades: this.ringBladeCount,
        patches: this.ringMeshes.length,
        visiblePatches,
        culledPatches: this.ringMeshes.length - visiblePatches,
        nearPatches: this.ringTierCounts.near > 0 ? 1 : 0,
        midPatches: this.ringTierCounts.mid > 0 ? 1 : 0,
        coveragePatches: this.ringTierCounts.far > 0 ? 1 : 0,
        superPatches: this.ringTierCounts.super > 0 ? 1 : 0,
        generatedCandidates: this.generationStats.generatedCandidates,
        acceptedCandidates: this.generationStats.acceptedCandidates,
        edgeSuppressedCandidates: this.generationStats.edgeSuppressedCandidates,
        midBladeCount: this.ringTierCounts.mid + this.ringTierCounts.far + this.ringTierCounts.super,
        gpuRingStatus: ringGpu.status,
        gpuRingCandidateCount: ringGpu.candidateCount,
        gpuRingVisibleNear: ringGpu.counts.near,
        gpuRingVisibleMid: ringGpu.counts.mid,
        gpuRingVisibleFar: ringGpu.counts.far,
        gpuRingVisibleSuper: ringGpu.counts.super,
        gpuRingDispatchMs: ringGpu.dispatchMs,
        gpuRingReadbackMs: ringGpu.readbackMs,
      };
      return;
    }
    let visiblePatches = 0;
    let nearPatches = 0;
    let midPatches = 0;
    let coveragePatches = 0;
    let superPatches = 0;
    let midBladeCount = 0;
    for (const patch of this.patches) {
      if (patch.visibleTier !== "hidden") visiblePatches++;
      if (patch.visibleTier === "near") nearPatches++;
      else if (patch.visibleTier === "mid") midPatches++;
      else if (patch.visibleTier === "far") coveragePatches++;
      else if (patch.visibleTier === "super") superPatches++;
      midBladeCount += patch.midBladeCount;
    }
    this.stats = {
      mode: this.settings.shaderMode,
      blades: this.bladeCount,
      patches: this.patches.length,
      visiblePatches,
      culledPatches: this.patches.length - visiblePatches,
      nearPatches,
      midPatches,
      coveragePatches,
      superPatches,
      generatedCandidates: this.generationStats.generatedCandidates,
      acceptedCandidates: this.generationStats.acceptedCandidates,
      edgeSuppressedCandidates: this.generationStats.edgeSuppressedCandidates,
      midBladeCount,
      gpuRingStatus: gpu.status,
      gpuRingCandidateCount: gpu.candidateCount,
      gpuRingVisibleNear: gpu.counts.near,
      gpuRingVisibleMid: gpu.counts.mid,
      gpuRingVisibleFar: gpu.counts.far,
      gpuRingVisibleSuper: gpu.counts.super,
      gpuRingDispatchMs: gpu.dispatchMs,
      gpuRingReadbackMs: gpu.readbackMs,
    };
  }
}
