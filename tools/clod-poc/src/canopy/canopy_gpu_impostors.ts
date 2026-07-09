import * as THREE from "three";
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
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, samples.length));
  mesh.name = "CanopyGpuImpostors";
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.count = samples.length;

  const center = canopyTextureFiniteCenter(set);
  const sunScale = canopySunScale(lighting);
  let maxDisplayChannel = 0;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i]!;
    const cardSize = canopyCardSize(set, config, sample);
    TMP_OBJECT.position.set(sample.x - center.x, sample.height, sample.z - center.z);
    TMP_OBJECT.quaternion.copy(HORIZONTAL_CANOPY_CARD);
    TMP_OBJECT.scale.set(cardSize, cardSize, 1);
    TMP_OBJECT.updateMatrix();
    mesh.setMatrixAt(i, TMP_OBJECT.matrix);
    const displayColor = canopyImpostorDisplayColor(sample.color, sample.coverage, sunScale);
    maxDisplayChannel = Math.max(maxDisplayChannel, displayColor.r, displayColor.g, displayColor.b);
    mesh.setColorAt(i, displayColor);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.position.set(center.x, 0, center.z);
  mesh.userData.canopyTextureSetRevision = set.revision;
  mesh.userData.canopyGpuImpostorInstances = samples.length;
  mesh.userData.canopyGpuImpostorCenterX = center.x;
  mesh.userData.canopyGpuImpostorCenterZ = center.z;
  mesh.userData.canopyGpuImpostorMaxColorChannel = maxDisplayChannel;
  mesh.userData.canopyGpuImpostorOpacity = CANOPY_IMPOSTOR_OPACITY;

  return {
    mesh,
    triangleCount: samples.length * 2,
    instanceCount: samples.length,
    maxInstances,
    coverageThreshold,
    centerX: center.x,
    centerZ: center.z,
    textureSetRevision: set.revision,
    dispose: () => {
      geometry.dispose();
      alphaMap.dispose();
      material.dispose();
    },
  };
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
  const data = new Uint8Array(size * size);
  const center = (size - 1) * 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - center) / center;
      const dy = (y - center) / center;
      const radius = Math.hypot(dx, dy);
      const core = 1 - smoothstep(0.35, 1.0, radius);
      const dither = ((x * 17 + y * 31) % 11) / 255;
      data[y * size + x] = Math.round(clamp01(core + dither) * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.UnsignedByteType);
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
  if (!ArrayBuffer.isView(data)) return new Float32Array(0);
  const copied = new Float32Array(data.byteLength / data.BYTES_PER_ELEMENT);
  for (let i = 0; i < copied.length; i++) copied[i] = Number(data[i] ?? 0);
  return copied;
}

function canopyCardSize(set: CanopyTextureSet, config: CanopyShellConfig, sample: CanopyGpuImpostorSample): number {
  const resolution = Math.max(1, set.resolution);
  const cellM = Math.max(1, set.extentM / resolution);
  const minCrown = Math.max(cellM * 0.55, config.treeDistribution.crownRadiusMinM * 2);
  const maxCrown = Math.max(minCrown, Math.min(cellM * 1.35, config.treeDistribution.crownRadiusMaxM * 2.2));
  const coverageT = clamp01((sample.coverage - DEFAULT_COVERAGE_THRESHOLD) / Math.max(0.01, 1 - DEFAULT_COVERAGE_THRESHOLD));
  const roughT = clamp01(sample.roughness);
  return THREE.MathUtils.lerp(minCrown, maxCrown, coverageT * 0.7 + roughT * 0.15);
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
