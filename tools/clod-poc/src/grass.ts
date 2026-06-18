import * as THREE from "three";
import { materialWeights, surfaceHeight, surfaceNormal } from "./terrain.js";
import type { ClodPageNode, PageFootprint } from "./types.js";

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
export const GRASS_SHADER_MODES = ["terrain-patch-v2", "classic"] as const;
export type GrassShaderMode = typeof GRASS_SHADER_MODES[number];
export const DEFAULT_GRASS_SHADER_MODE: GrassShaderMode = "terrain-patch-v2";
const V2_NEAR_DISTANCE_FRACTION = 0.42;
const V2_MID_DISTANCE_FRACTION = 0.78;
const V2_MID_INSTANCE_FRACTION = 0.35;
const V2_EDGE_SAMPLE_SCALE = 1.25;
const V2_EDGE_HEIGHT_SOFT = 1.5;
const V2_EDGE_HEIGHT_HARD = 4.5;

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
  varying vec2 vUv;
  varying float vColorMix;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  void main() {
    float bend = uv.y * uv.y;
    float windTime = uTime * uWindSpeed + aPhase + aOffset.x * 0.071 + aOffset.z * 0.053;
    vec2 wind = vec2(sin(windTime), cos(windTime * 0.83 + aPhase * 0.37));
    wind *= uWindStrength * aHeight * bend;

    vec3 localPosition = vec3(position.x * uBladeWidth, position.y * aHeight, position.z);
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
  attribute vec3 aOffset;
  attribute float aHeight;
  attribute float aRotY;
  attribute float aPhase;
  attribute float aColorMix;
  attribute float aEdgeFade;
  attribute float aNormalY;
  varying vec2 vUv;
  varying float vColorMix;
  varying float vEdgeFade;
  varying float vDistanceFade;
  varying vec3 vWorldNormal;

  void main() {
    float dist = distance(cameraPosition.xz, aOffset.xz);
    float farFade = 1.0 - smoothstep(uMidDistance * 0.82, uMidDistance, dist);
    float nearWeight = 1.0 - smoothstep(uNearDistance * 0.75, uNearDistance, dist);
    float heightFactor = uv.y * uv.y;
    float edge = clamp(aEdgeFade, 0.0, 1.0);
    float slope = smoothstep(0.55, 0.96, aNormalY);
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
      position.x * uBladeWidth * widthTaper,
      position.y * aHeight * edgeHeight * slopeHeight,
      position.z * uBladeWidth * widthTaper
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
    vWorldNormal = normalize(vec3(
      c * localNormal.x + s * localNormal.z,
      localNormal.y,
      -s * localNormal.x + c * localNormal.z
    ));
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
}

export interface GrassBladeInstance {
  offset: [number, number, number];
  height: number;
  rotationY: number;
  phase: number;
  colorMix: number;
  edgeFade: number;
  normalY: number;
}

export interface GrassCandidateSample {
  height: number;
  normalY: number;
  grassWeight: number;
  threshold: number;
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
  generatedCandidates: number;
  acceptedCandidates: number;
  edgeSuppressedCandidates: number;
  midBladeCount: number;
}

interface GrassGenerationStats {
  generatedCandidates: number;
  acceptedCandidates: number;
  edgeSuppressedCandidates: number;
}

interface GrassPatch {
  nodeId: string;
  meshes: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>[];
  centerX: number;
  centerZ: number;
  radius: number;
  bladeCount: number;
  midBladeCount: number;
  visibleTier: "hidden" | "near" | "mid" | "coverage";
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
    && sample.grassWeight > MIN_GRASS_WEIGHT
    && sample.threshold < sample.grassWeight;
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
      const height = surfaceHeight(x, z);
      const normalY = surfaceNormal(x, z)[1];
      const grassWeight = materialWeights(height, normalY)[0];
      if (!acceptsGrassCandidate(settings, {
        height,
        normalY,
        grassWeight,
        threshold: hash2(gridX, gridZ, settings.seed + 307),
      })) continue;
      const edgeFade = terrainPatchMode ? edgeFadeForCandidate(x, z, height, normalY, spacing) : 1;
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
          offset: [x, height + 0.02, z],
          height: settings.bladeHeight * heightScale,
          rotationY: hash2(gridX, gridZ, settings.seed + 503) * TWO_PI,
          phase: hash2(gridX, gridZ, settings.seed + 601) * TWO_PI,
          colorMix: Math.pow(hash2(gridX, gridZ, settings.seed + 701), 2),
          edgeFade,
          normalY,
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

export class GrassSystem {
  private readonly scene: THREE.Scene;
  private readonly nodes: ClodPageNode[];
  private readonly worldCells: number;
  private readonly root = new THREE.Group();
  private readonly classicBladeGeometry = createBladeGeometry();
  private readonly terrainPatchNearGeometry = createBladeGeometry(V2_NEAR_BLADE_ROWS);
  private readonly terrainPatchNearCrossedGeometry = createBladeGeometry(V2_NEAR_BLADE_ROWS, true);
  private readonly terrainPatchMidGeometry = createBladeGeometry(V2_MID_BLADE_ROWS);
  private readonly materials = new Map<GrassShaderMode, THREE.ShaderMaterial>();
  private settings: GrassSettings;
  private patches: GrassPatch[] = [];
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
    generatedCandidates: 0,
    acceptedCandidates: 0,
    edgeSuppressedCandidates: 0,
    midBladeCount: 0,
  };
  private readonly lastCenter: THREE.Vector3;

  constructor(options: GrassSystemOptions) {
    this.scene = options.scene;
    this.nodes = options.nodes
      .filter((node) => node.level === 0)
      .sort((a, b) => a.footprint.minZ - b.footprint.minZ || a.footprint.minX - b.footprint.minX);
    this.worldCells = options.worldCells;
    this.settings = { ...options.settings };
    for (const mode of GRASS_SHADER_MODES) {
      this.materials.set(mode, createGrassMaterial(this.settings, options.lighting, mode));
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
    if (enabled && !wasEnabled && this.patches.length === 0) this.refreshPatches(this.lastCenter);
  }

  updateSettings(settings: Partial<GrassSettings>): void {
    Object.assign(this.settings, settings);
    this.updateMaterialUniforms();
    this.setEnabled(this.settings.enabled);
  }

  updateLighting(lighting: GrassLighting): void {
    for (const material of this.materials.values()) {
      material.uniforms.uLight.value.copy(lighting.light);
      material.uniforms.uSunColor.value.copy(lighting.sunColor);
      material.uniforms.uSkyLight.value.copy(lighting.skyLight);
      material.uniforms.uGroundLight.value.copy(lighting.groundLight);
    }
  }

  update(timeSeconds: number, center: THREE.Vector3): void {
    for (const material of this.materials.values()) {
      material.uniforms.uTime.value = timeSeconds;
    }
    this.lastCenter.copy(center);
    if (!this.settings.enabled) {
      this.updateStats();
      return;
    }
    this.refreshPatches(center);
    for (const patch of this.patches) {
      const distance = Math.hypot(center.x - patch.centerX, center.z - patch.centerZ);
      this.updatePatchVisibility(patch, distance);
    }
    this.updateStats();
  }

  rebuild(): void {
    this.clearPatches();
    if (this.settings.enabled) this.refreshPatches(this.lastCenter);
    this.root.visible = this.settings.enabled;
  }

  /** Regenerate grass for edited LOD0 pages so blades track the current surface. */
  rebuildNodePatches(nodeIds: Iterable<string>): void {
    const ids = new Set(nodeIds);
    if (ids.size === 0) return;
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
    this.refreshPatches(this.lastCenter);
  }

  dispose(): void {
    this.clearPatches();
    this.root.clear();
    this.scene.remove(this.root);
    this.classicBladeGeometry.dispose();
    this.terrainPatchNearGeometry.dispose();
    this.terrainPatchNearCrossedGeometry.dispose();
    this.terrainPatchMidGeometry.dispose();
    for (const material of this.materials.values()) material.dispose();
  }

  getBladeCount(): number {
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

  private refreshPatches(center: THREE.Vector3): void {
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
    for (let index = 0; index < newNodes.length && remainingBudget > 0; index++) {
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
    }
  }

  private createPatch(nodeId: string, footprint: PageFootprint, instances: GrassBladeInstance[]): GrassPatch {
    const shader = grassShaderDefinition(this.settings.shaderMode);
    if (shader.patchStyle === "terrain-patch") {
      return this.createTerrainPatch(nodeId, footprint, instances);
    }
    const geometry = new THREE.InstancedBufferGeometry();
    this.populateGeometry(geometry, this.classicBladeGeometry, footprint, instances);

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
    const nearGeometry = new THREE.InstancedBufferGeometry();
    this.populateGeometry(nearGeometry, nearBlade, footprint, instances);

    const midCount = Math.max(1, Math.floor(instances.length * V2_MID_INSTANCE_FRACTION));
    const midInstances = instances.slice(0, midCount).map((instance) => ({
      ...instance,
      height: instance.height * 1.55,
      edgeFade: Math.min(1, instance.edgeFade * 1.15),
    }));
    const midGeometry = new THREE.InstancedBufferGeometry();
    this.populateGeometry(midGeometry, this.terrainPatchMidGeometry, footprint, midInstances);

    const centerX = (footprint.minX + footprint.maxX) * 0.5;
    const centerZ = (footprint.minZ + footprint.maxZ) * 0.5;
    const radius = Math.hypot(footprint.maxX - footprint.minX, footprint.maxZ - footprint.minZ) * 0.5;
    const material = this.materialFor(this.settings.shaderMode);
    const nearMesh = new THREE.Mesh(nearGeometry, material);
    const midMesh = new THREE.Mesh(midGeometry, material);
    return {
      nodeId,
      meshes: [nearMesh, midMesh],
      centerX,
      centerZ,
      radius,
      bladeCount: instances.length,
      midBladeCount: midInstances.length,
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
    for (const [mode, material] of this.materials) {
      material.uniforms.uBladeWidth.value = this.settings.bladeWidth;
      material.uniforms.uWindStrength.value = this.settings.windStrength;
      material.uniforms.uWindSpeed.value = this.settings.windSpeed;
      material.uniforms.uNearDistance.value = this.settings.distance * V2_NEAR_DISTANCE_FRACTION;
      material.uniforms.uMidDistance.value = this.settings.distance * V2_MID_DISTANCE_FRACTION;
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
    const coverageDistance = this.settings.distance + patch.radius;
    patch.meshes[0].visible = distance <= nearDistance;
    patch.meshes[1].visible = distance > nearDistance && distance <= midDistance;
    patch.visibleTier = patch.meshes[0].visible
      ? "near"
      : patch.meshes[1].visible
        ? "mid"
        : distance <= coverageDistance ? "coverage" : "hidden";
  }

  private removePatch(patch: GrassPatch): void {
    for (const mesh of patch.meshes) {
      this.root.remove(mesh);
      mesh.geometry.dispose();
    }
  }

  private materialFor(mode: GrassShaderMode): THREE.ShaderMaterial {
    const material = this.materials.get(mode);
    if (!material) throw new Error(`Missing grass material for shader mode: ${mode}`);
    return material;
  }

  private updateStats(): void {
    let visiblePatches = 0;
    let nearPatches = 0;
    let midPatches = 0;
    let coveragePatches = 0;
    let midBladeCount = 0;
    for (const patch of this.patches) {
      if (patch.visibleTier !== "hidden") visiblePatches++;
      if (patch.visibleTier === "near") nearPatches++;
      else if (patch.visibleTier === "mid") midPatches++;
      else if (patch.visibleTier === "coverage") coveragePatches++;
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
      generatedCandidates: this.generationStats.generatedCandidates,
      acceptedCandidates: this.generationStats.acceptedCandidates,
      edgeSuppressedCandidates: this.generationStats.edgeSuppressedCandidates,
      midBladeCount,
    };
  }
}
