import * as THREE from "three";
import { StorageInstancedBufferAttribute } from "three/webgpu";
import type { EnvironmentLighting } from "../environment/environment.js";
import type { CanopyShellConfig } from "./canopy_types_internal.js";
import type { CanopyTextureSet } from "./canopy_types.js";

export interface CanopyGpuImpostorSample {
  x: number;
  z: number;
  height: number;
  coverage: number;
  roughness: number;
  color: THREE.Color;
}

export interface CanopyGpuImpostorOptions {
  maxInstances: number;
  coverageThreshold: number;
  sampleStride: number;
}

export interface CanopyGpuImpostorShell {
  mesh: THREE.InstancedMesh;
  triangleCount: number;
  instanceCount: number;
  maxInstances: number;
  coverageThreshold: number;
  centerX: number;
  centerZ: number;
  textureSetRevision: number;
  dispose(): void;
}

const DEFAULT_COVERAGE_THRESHOLD = 0.12;
const DEFAULT_MIN_INSTANCES = 64;
const DEFAULT_MAX_INSTANCES = 8192;
const DEFAULT_SAMPLE_STRIDE = 1;
const CANOPY_IMPOSTOR_ALPHA_TEXTURE_SIZE = 48;
const CANOPY_IMPOSTOR_OPACITY = 0.58;
const CANOPY_IMPOSTOR_ALPHA_TEST = 0.08;
const CANOPY_IMPOSTOR_MAX_COLOR_CHANNEL = 0.42;
const TMP_OBJECT = new THREE.Object3D();
const HORIZONTAL_CANOPY_CARD = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

type NumericTextureArray =
  | Float32Array
  | Float64Array
  | Uint8Array
  | Uint8ClampedArray
  | Uint16Array
  | Uint32Array
  | Int8Array
  | Int16Array
  | Int32Array;

export function maxCanopyGpuImpostorInstances(maxShellTris: number): number {
  if (!Number.isFinite(maxShellTris) || maxShellTris <= 0) return DEFAULT_MIN_INSTANCES;
  return Math.max(DEFAULT_MIN_INSTANCES, Math.min(DEFAULT_MAX_INSTANCES, Math.floor(maxShellTris / 2)));
}

export function canopyTextureFiniteCenter(set: CanopyTextureSet): { x: number; z: number } {
  const x = set.originX + set.extentM * 0.5;
  const z = set.originZ + set.extentM * 0.5;
  return {
    x: Number.isFinite(x) ? x : 0,
    z: Number.isFinite(z) ? z : 0,
  };
}

export function canopyImpostorDisplayColor(input: THREE.Color, coverage: number, sunScale: number): THREE.Color {
  const safeCoverage = clamp01(coverage);
  const safeSun = Math.max(0.35, Math.min(1.05, Number.isFinite(sunScale) ? sunScale : 0.75));
  const forestBase = new THREE.Color(0.10, 0.17, 0.08);
  const desaturated = desaturateColor(input, 0.35);
  const coverageMix = 0.28 + safeCoverage * 0.42;
  const display = forestBase.lerp(desaturated, coverageMix).multiplyScalar(0.78 + safeCoverage * 0.12).multiplyScalar(safeSun);
  display.r = Math.min(display.r, CANOPY_IMPOSTOR_MAX_COLOR_CHANNEL);
  display.g = Math.min(display.g, CANOPY_IMPOSTOR_MAX_COLOR_CHANNEL);
  display.b = Math.min(display.b, CANOPY_IMPOSTOR_MAX_COLOR_CHANNEL);
  return display;
}

export function buildCanopyGpuImpostorsFromTextureSet(
  set: CanopyTextureSet,
  config: CanopyShellConfig,
  lighting: EnvironmentLighting,
  options: Partial<CanopyGpuImpostorOptions> = {},
): CanopyGpuImpostorShell {
  const maxInstances = sanitizePositiveInteger(options.maxInstances, maxCanopyGpuImpostorInstances(config.budgets.maxShellTris));
  const coverageThreshold = sanitizeCoverage(options.coverageThreshold ?? DEFAULT_COVERAGE_THRESHOLD);
  const sampleStride = sanitizePositiveInteger(options.sampleStride, DEFAULT_SAMPLE_STRIDE);
  const samples = selectCanopyGpuImpostorSamples(set, maxInstances, coverageThreshold, sampleStride);

  const geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
  const alphaMap = createCanopyImpostorAlphaMap();
  const material = new THREE.MeshBasicMaterial({
    alphaMap,
    vertexColors: true,
    transparent: true,
    opacity: CANOPY_IMPOSTOR_OPACITY,
    alphaTest: CANOPY_IMPOSTOR_ALPHA_TEST,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    toneMapped: true,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, maxInstances));
  mesh.instanceMatrix = new StorageInstancedBufferAttribute(Math.max(1, maxInstances), 16);
  mesh.name = "CanopyGpuImpostors";
  mesh.frustumCulled = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.count = samples.length;

  const shell: CanopyGpuImpostorShell = {
    mesh,
    triangleCount: 0,
    instanceCount: 0,
    maxInstances,
    coverageThreshold,
    centerX: 0,
    centerZ: 0,
    textureSetRevision: -1,
    dispose: () => {
      geometry.dispose();
      alphaMap.dispose();
      material.dispose();
    },
  };
  updateCanopyGpuImpostorsFromTextureSet(shell, set, config, lighting, sampleStride, samples);
  return shell;
}

export function updateCanopyGpuImpostorsFromTextureSet(
  shell: CanopyGpuImpostorShell,
  set: CanopyTextureSet,
  config: CanopyShellConfig,
  lighting: EnvironmentLighting,
  sampleStride = DEFAULT_SAMPLE_STRIDE,
  selected?: CanopyGpuImpostorSample[],
): void {
  const samples = selected ?? selectCanopyGpuImpostorSamples(
    set,
    shell.maxInstances,
    shell.coverageThreshold,
    sampleStride,
  );
  const center = canopyTextureFiniteCenter(set);
  const sunScale = canopySunScale(lighting);
  let maxDisplayChannel = 0;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i]!;
    const unifiedDensity = shell.coverageThreshold < DEFAULT_COVERAGE_THRESHOLD;
    const cardSize = canopyCardSize(set, config, sample, shell.coverageThreshold);
    const jitter = unifiedDensity ? canopyCardJitter(sample.x, sample.z, set.extentM / set.resolution) : { x: 0, z: 0 };
    TMP_OBJECT.position.set(sample.x + jitter.x - center.x, sample.height, sample.z + jitter.z - center.z);
    TMP_OBJECT.quaternion.copy(HORIZONTAL_CANOPY_CARD);
    TMP_OBJECT.scale.set(cardSize, cardSize, 1);
    TMP_OBJECT.updateMatrix();
    shell.mesh.setMatrixAt(i, TMP_OBJECT.matrix);
    const displayCoverage = unifiedDensity ? clamp01(sample.coverage / 0.05) : sample.coverage;
    const displayColor = canopyImpostorDisplayColor(sample.color, displayCoverage, sunScale);
    maxDisplayChannel = Math.max(maxDisplayChannel, displayColor.r, displayColor.g, displayColor.b);
    shell.mesh.setColorAt(i, displayColor);
  }
  shell.mesh.count = samples.length;
  shell.mesh.instanceMatrix.needsUpdate = true;
  if (shell.mesh.instanceColor) shell.mesh.instanceColor.needsUpdate = true;
  shell.mesh.computeBoundingBox();
  shell.mesh.computeBoundingSphere();
  shell.mesh.position.set(center.x, 0, center.z);
  shell.mesh.userData.canopyTextureSetRevision = set.revision;
  shell.mesh.userData.canopyGpuImpostorInstances = samples.length;
  shell.mesh.userData.canopyGpuImpostorCenterX = center.x;
  shell.mesh.userData.canopyGpuImpostorCenterZ = center.z;
  shell.mesh.userData.canopyGpuImpostorMaxColorChannel = maxDisplayChannel;
  shell.mesh.userData.canopyGpuImpostorOpacity = (shell.mesh.material as THREE.MeshBasicMaterial).opacity;
  shell.triangleCount = samples.length * 2;
  shell.instanceCount = samples.length;
  shell.centerX = center.x;
  shell.centerZ = center.z;
  shell.textureSetRevision = set.revision;
}

export function setCanopyGpuImpostorOpacity(shell: CanopyGpuImpostorShell, opacity: number): void {
  const material = shell.mesh.material as THREE.MeshBasicMaterial;
  material.opacity = THREE.MathUtils.clamp(opacity, 0, CANOPY_IMPOSTOR_OPACITY);
  shell.mesh.userData.canopyGpuImpostorOpacity = material.opacity;
}

export function canopyGpuImpostorDefaultOpacity(): number {
  return CANOPY_IMPOSTOR_OPACITY;
}

export function selectCanopyGpuImpostorSamples(
  set: CanopyTextureSet,
  maxInstances: number,
  coverageThreshold: number,
  sampleStride = 1,
): CanopyGpuImpostorSample[] {
  const resolution = Math.max(1, Math.floor(set.resolution));
  const heightData = textureFloatData(set.heightTexture);
  const coverageData = textureFloatData(set.coverageTexture);
  const speciesData = textureFloatData(set.speciesTexture);
  const roughnessData = textureFloatData(set.roughnessTexture);
  const candidates: CanopyGpuImpostorSample[] = [];
  const stride = Math.max(1, Math.floor(sampleStride));
  const cellM = set.extentM / resolution;

  for (let z = 0; z < resolution; z += stride) {
    for (let x = 0; x < resolution; x += stride) {
      const index = z * resolution + x;
      const coverage = clamp01(coverageData[index] ?? 0);
      if (coverage < coverageThreshold) continue;
      const speciesIndex = speciesData.length >= resolution * resolution * 4 ? index * 4 : index * 3;
      candidates.push({
        x: set.originX + (x + 0.5) * cellM,
        z: set.originZ + (z + 0.5) * cellM,
        height: finiteOr(heightData[index], 0),
        coverage,
        roughness: clamp01(roughnessData[index] ?? 0),
        color: new THREE.Color(
          clamp01(speciesData[speciesIndex] ?? 0.06),
          clamp01(speciesData[speciesIndex + 1] ?? 0.12),
          clamp01(speciesData[speciesIndex + 2] ?? 0.05),
        ),
      });
    }
  }

  if (candidates.length <= maxInstances) return candidates;
  const picked: CanopyGpuImpostorSample[] = [];
  const step = candidates.length / maxInstances;
  for (let i = 0; i < maxInstances; i++) {
    picked.push(candidates[Math.floor(i * step)]!);
  }
  return picked;
}

function createCanopyImpostorAlphaMap(): THREE.DataTexture {
  const size = CANOPY_IMPOSTOR_ALPHA_TEXTURE_SIZE;
  const data = new Uint8Array(size * size * 4);
  const center = (size - 1) * 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - center) / center;
      const dy = (y - center) / center;
      const radius = Math.hypot(dx, dy);
      const core = 1 - smoothstep(0.35, 1.0, radius);
      const dither = ((x * 17 + y * 31) % 11) / 255;
      const value = Math.round(clamp01(core + dither) * 255);
      const offset = (y * size + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = value;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = "CanopyGpuImpostorAlphaMap";
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function textureFloatData(texture: THREE.DataTexture): Float32Array {
  const data = (texture.image as { data?: unknown }).data;
  if (data instanceof Float32Array) return data;
  if (!isNumericTextureArray(data)) return new Float32Array(0);
  const copied = new Float32Array(data.length);
  for (let i = 0; i < copied.length; i++) copied[i] = Number(data[i] ?? 0);
  return copied;
}

function isNumericTextureArray(data: unknown): data is NumericTextureArray {
  return data instanceof Float32Array
    || data instanceof Float64Array
    || data instanceof Uint8Array
    || data instanceof Uint8ClampedArray
    || data instanceof Uint16Array
    || data instanceof Uint32Array
    || data instanceof Int8Array
    || data instanceof Int16Array
    || data instanceof Int32Array;
}

function canopyCardSize(
  set: CanopyTextureSet,
  config: CanopyShellConfig,
  sample: CanopyGpuImpostorSample,
  coverageThreshold: number,
): number {
  const resolution = Math.max(1, set.resolution);
  const cellM = Math.max(1, set.extentM / resolution);
  if (coverageThreshold < DEFAULT_COVERAGE_THRESHOLD) {
    const minPatch = Math.max(config.treeDistribution.crownRadiusMinM * 2, Math.min(40, cellM * 0.12));
    const maxPatch = Math.max(minPatch, Math.min(72, cellM * 0.30));
    const coverageT = clamp01((sample.coverage - coverageThreshold) / Math.max(0.01, 0.05 - coverageThreshold));
    return THREE.MathUtils.lerp(minPatch, maxPatch, coverageT * 0.75 + clamp01(sample.roughness) * 0.15);
  }
  const minCrown = Math.max(cellM * 0.55, config.treeDistribution.crownRadiusMinM * 2);
  const maxCrown = Math.max(minCrown, Math.min(cellM * 1.35, config.treeDistribution.crownRadiusMaxM * 2.2));
  const coverageT = clamp01((sample.coverage - DEFAULT_COVERAGE_THRESHOLD) / Math.max(0.01, 1 - DEFAULT_COVERAGE_THRESHOLD));
  const roughT = clamp01(sample.roughness);
  return THREE.MathUtils.lerp(minCrown, maxCrown, coverageT * 0.7 + roughT * 0.15);
}

function canopyCardJitter(x: number, z: number, cellM: number): { x: number; z: number } {
  const scale = Math.max(0, cellM) * 0.22;
  return {
    x: (hash01(x, z) - 0.5) * scale,
    z: (hash01(z + 19.7, x - 7.3) - 0.5) * scale,
  };
}

function hash01(x: number, z: number): number {
  const value = Math.sin(x * 12.9898 + z * 78.233) * 43_758.5453;
  return value - Math.floor(value);
}

function canopySunScale(lighting: EnvironmentLighting): number {
  const sun = Math.max(lighting.sunColor.r, lighting.sunColor.g, lighting.sunColor.b);
  const sky = Math.max(lighting.skyLight.r, lighting.skyLight.g, lighting.skyLight.b);
  return Math.max(0.4, Math.min(1.05, sky * 0.65 + sun * 0.22));
}

function desaturateColor(color: THREE.Color, amount: number): THREE.Color {
  const t = clamp01(amount);
  const luma = color.r * 0.299 + color.g * 0.587 + color.b * 0.114;
  return new THREE.Color(
    THREE.MathUtils.lerp(color.r, luma, t),
    THREE.MathUtils.lerp(color.g, luma, t),
    THREE.MathUtils.lerp(color.b, luma, t),
  );
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function sanitizePositiveInteger(value: number | undefined, fallback: number): number {
  const parsed = Number.isFinite(value) ? Math.floor(value as number) : fallback;
  return Math.max(1, parsed);
}

function sanitizeCoverage(value: number): number {
  return Math.max(0.01, Math.min(0.95, Number.isFinite(value) ? value : DEFAULT_COVERAGE_THRESHOLD));
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
