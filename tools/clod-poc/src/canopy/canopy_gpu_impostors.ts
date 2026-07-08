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
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.84,
    alphaTest: 0.04,
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
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i]!;
    const cardSize = canopyCardSize(set, config, sample);
    TMP_OBJECT.position.set(sample.x - center.x, sample.height, sample.z - center.z);
    TMP_OBJECT.quaternion.copy(HORIZONTAL_CANOPY_CARD);
    TMP_OBJECT.scale.set(cardSize, cardSize, 1);
    TMP_OBJECT.updateMatrix();
    mesh.setMatrixAt(i, TMP_OBJECT.matrix);
    mesh.setColorAt(i, sample.color.clone().multiplyScalar(sunScale));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.position.set(center.x, 0, center.z);
  mesh.userData.canopyTextureSetRevision = set.revision;
  mesh.userData.canopyGpuImpostorInstances = samples.length;
  mesh.userData.canopyGpuImpostorCenterX = center.x;
  mesh.userData.canopyGpuImpostorCenterZ = center.z;

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
  const minCrown = Math.max(cellM, config.treeDistribution.crownRadiusMinM * 2);
  const maxCrown = Math.max(minCrown, config.treeDistribution.crownRadiusMaxM * 2.35);
  const coverageT = clamp01((sample.coverage - DEFAULT_COVERAGE_THRESHOLD) / Math.max(0.01, 1 - DEFAULT_COVERAGE_THRESHOLD));
  const roughT = clamp01(sample.roughness);
  return THREE.MathUtils.lerp(minCrown, maxCrown, coverageT * 0.75 + roughT * 0.25);
}

function canopySunScale(lighting: EnvironmentLighting): number {
  const sun = Math.max(lighting.sunColor.r, lighting.sunColor.g, lighting.sunColor.b);
  const sky = Math.max(lighting.skyLight.r, lighting.skyLight.g, lighting.skyLight.b);
  return Math.max(0.35, Math.min(1.35, sky * 0.8 + sun * 0.35));
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
