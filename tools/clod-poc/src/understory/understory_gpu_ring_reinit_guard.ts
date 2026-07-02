import type * as THREE from "three";
import {
  UnderstoryGpuRingCompute,
  createGpuRingDrawResources,
  type UnderstoryGpuRingDrawResources,
  type UnderstoryGpuRingStats,
  type UnderstoryHydrologyData,
  type UnderstoryWebGpuBackendAccess,
} from "../gpu/understory_ring_compute.js";
import { resolveDigEdits } from "../gpu/terrain_field_core.js";
import { getDigEditsSnapshot } from "../terrain/terrain.js";
import type { EnvironmentLighting } from "../environment/environment.js";
import { UnderstorySystem } from "./understory_system.js";
import type { UnderstorySettings } from "./understory_config.js";
import { understoryGpuRingKey } from "./understory_system_support.js";

type UnderstoryGpuRingHost = {
  gpuDevice: GPUDevice | null;
  gpuBackend: UnderstoryWebGpuBackendAccess | null;
  settings: UnderstorySettings;
  worldCells: number;
  currentLighting: EnvironmentLighting | undefined;
  hydrologyData: UnderstoryHydrologyData | null;
  hydrologyWaterTexture: THREE.Texture | null;
  root: THREE.Group;
  ringMeshes: THREE.Mesh[];
  gpuRingCompute: UnderstoryGpuRingCompute | null;
  gpuRingInit: Promise<void> | null;
  gpuRingKey: string;
  gpuRingGeneration: number;
  gpuRingDraw: UnderstoryGpuRingDrawResources | null;
  gpuRingStats: UnderstoryGpuRingStats;
  usesGpuRingDraw(): boolean;
  clearGpuRing(): void;
};

type UnderstoryGpuRingPrototype = {
  ensureGpuRingCompute(this: UnderstoryGpuRingHost): void;
};

const prototype = UnderstorySystem.prototype as unknown as UnderstoryGpuRingPrototype;

prototype.ensureGpuRingCompute = function ensureGpuRingCompute(this: UnderstoryGpuRingHost): void {
  if (!this.gpuDevice || !this.gpuBackend || !this.usesGpuRingDraw()) return;

  const key = understoryGpuRingKey(this.settings, this.worldCells);
  if (this.gpuRingCompute && this.gpuRingKey === key) return;
  if (this.gpuRingInit && this.gpuRingKey === key) return;

  if (this.gpuRingCompute || this.gpuRingInit || this.gpuRingDraw || this.ringMeshes.length > 0) {
    this.clearGpuRing();
  }

  this.gpuRingKey = key;
  this.gpuRingDraw = createGpuRingDrawResources(
    this.settings,
    this.worldCells,
    this.gpuBackend,
    this.currentLighting,
    this.hydrologyData,
    this.hydrologyWaterTexture,
  );
  for (const mesh of this.gpuRingDraw.meshes) {
    mesh.visible = false;
    this.root.add(mesh);
    this.ringMeshes.push(mesh);
  }
  this.gpuRingStats = {
    status: "initializing",
    candidateCount: 0,
    candidateCountBeforePrefilter: 0,
    candidateCountAfterPrefilter: 0,
    acceptedCandidates: 0,
    counts: this.gpuRingStats.counts,
    groupCounts: [],
    overflowed: false,
    submitMs: null,
    readbackMs: null,
    skippedDispatches: 0,
  };

  const initKey = key;
  const initGeneration = this.gpuRingGeneration;
  const edits = resolveDigEdits(getDigEditsSnapshot());
  this.gpuRingInit = UnderstoryGpuRingCompute.create(
    this.gpuDevice,
    edits,
    this.gpuRingDraw.outputBuffers,
    this.settings,
    this.hydrologyData,
  ).then((compute) => {
    if (this.gpuRingKey !== initKey || this.gpuRingGeneration !== initGeneration) {
      compute.destroy();
      return;
    }
    this.gpuRingCompute = compute;
    this.gpuRingStats = compute.stats(this.settings.enabled);
  }).catch((error) => {
    if (this.gpuRingKey !== initKey || this.gpuRingGeneration !== initGeneration) return;
    console.warn("[understory] GPU ring compute init failed:", error);
    this.gpuRingStats = { ...this.gpuRingStats, status: "failed", reason: String(error) };
  }).finally(() => {
    if (this.gpuRingKey === initKey && this.gpuRingGeneration === initGeneration) this.gpuRingInit = null;
  });
};
