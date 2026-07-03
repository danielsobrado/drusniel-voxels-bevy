import * as THREE from "three";
import type { PageFootprint } from "../types.js";
import { getDigEditRevision } from "../terrain/terrain.js";
import type { VegetationTerrainRejectionReason } from "../vegetation/terrain_rejection_config.js";
import type {
  UnderstoryClass,
  UnderstoryClassSettings,
  UnderstorySettings,
} from "./understory_config.js";
import {
  emptyUnderstoryGenerationStats,
  type UnderstoryGenerationStats,
  type UnderstoryInstance,
} from "./understory_instances.js";

export interface UnderstoryStats extends UnderstoryGenerationStats {
  totalInstances: number;
  patches: number;
  visiblePatches: number;
  culledPatches: number;
  shrub: number;
  fern: number;
  sapling: number;
  flower: number;
  deadLog: number;
  stump: number;
  gpuStatus: "disabled" | "unsupported" | "ring" | "fallback-cpu" | "error";
  gpuCandidateCount: number;
  gpuCandidateCountBeforePrefilter?: number;
  gpuCandidateCountAfterPrefilter?: number;
  gpuPrefilterTestedClusters?: number;
  gpuPrefilterRejectedClusters?: number;
  gpuPrefilterAcceptedClusters?: number;
  gpuPrefilterUnknownKeptClusters?: number;
  gpuAcceptedCount: number;
  gpuVisibleCount: number;
  gpuOverflowed: boolean;
  gpuDispatchMs: number | null;
}

export interface UnderstoryLightingProxy {
  x: number;
  z: number;
  classId: UnderstoryClass;
  scale: number;
  densityWeight: number;
}

export interface UnderstoryPatch {
  nodeId: string;
  footprint: PageFootprint;
  centerX: number;
  centerZ: number;
  radius: number;
  group: THREE.Group;
  instances: UnderstoryInstance[];
  meshes: Record<UnderstoryClass, THREE.InstancedMesh>;
  visible: boolean;
  generationStats: UnderstoryGenerationStats;
}

const INSTANCE_ATTRIBUTE_EPSILON = 1e-5;

export function understoryUsesGpuRingDraw(settings: UnderstorySettings): boolean {
  return settings.enabled && settings.gpu.enabled && !settings.gpu.debugForceCpu;
}

export function emptyUnderstoryStats(): UnderstoryStats {
  return {
    totalInstances: 0,
    patches: 0,
    visiblePatches: 0,
    culledPatches: 0,
    shrub: 0,
    fern: 0,
    sapling: 0,
    flower: 0,
    deadLog: 0,
    stump: 0,
    gpuStatus: "disabled",
    gpuCandidateCount: 0,
    gpuCandidateCountBeforePrefilter: 0,
    gpuCandidateCountAfterPrefilter: 0,
    gpuPrefilterTestedClusters: 0,
    gpuPrefilterRejectedClusters: 0,
    gpuPrefilterAcceptedClusters: 0,
    gpuPrefilterUnknownKeptClusters: 0,
    gpuAcceptedCount: 0,
    gpuVisibleCount: 0,
    gpuOverflowed: false,
    gpuDispatchMs: null,
    ...emptyUnderstoryGenerationStats(),
  };
}

export function mergeGenerationStats(target: UnderstoryGenerationStats, source: UnderstoryGenerationStats): void {
  target.generatedCandidates += source.generatedCandidates;
  target.acceptedCandidates += source.acceptedCandidates;
  target.rejectedSlope += source.rejectedSlope;
  target.rejectedHeight += source.rejectedHeight;
  target.rejectedMaterial += source.rejectedMaterial;
  target.rejectedEcology += source.rejectedEcology;
  target.rejectedSpacing += source.rejectedSpacing;
  target.acceptedShrub += source.acceptedShrub;
  target.acceptedFern += source.acceptedFern;
  target.acceptedSapling += source.acceptedSapling;
  target.acceptedFlower += source.acceptedFlower;
  target.acceptedDeadLog += source.acceptedDeadLog;
  target.acceptedStump += source.acceptedStump;
  target.earlyTerrainRejectedPatches = (target.earlyTerrainRejectedPatches ?? 0) + (source.earlyTerrainRejectedPatches ?? 0);
  target.earlyTerrainSkippedCandidates = (target.earlyTerrainSkippedCandidates ?? 0) + (source.earlyTerrainSkippedCandidates ?? 0);
  mergeReasonCounts(target, source);
}

export function clampFootprint(footprint: PageFootprint, worldCells: number): PageFootprint {
  return {
    minX: THREE.MathUtils.clamp(footprint.minX, 0, worldCells),
    minZ: THREE.MathUtils.clamp(footprint.minZ, 0, worldCells),
    maxX: THREE.MathUtils.clamp(footprint.maxX, 0, worldCells),
    maxZ: THREE.MathUtils.clamp(footprint.maxZ, 0, worldCells),
  };
}

export function footprintCenterX(footprint: PageFootprint): number {
  return (footprint.minX + footprint.maxX) * 0.5;
}

export function footprintCenterZ(footprint: PageFootprint): number {
  return (footprint.minZ + footprint.maxZ) * 0.5;
}

export function footprintRadius(footprint: PageFootprint): number {
  return Math.hypot(footprint.maxX - footprint.minX, footprint.maxZ - footprint.minZ) * 0.5;
}

export function distance2d(ax: number, az: number, bx: number, bz: number): number {
  if (Math.abs(ax - bx) < INSTANCE_ATTRIBUTE_EPSILON && Math.abs(az - bz) < INSTANCE_ATTRIBUTE_EPSILON) return 0;
  return Math.hypot(ax - bx, az - bz);
}

function mergeReasonCounts(target: UnderstoryGenerationStats, source: UnderstoryGenerationStats): void {
  if (!source.earlyTerrainReasonCounts) return;
  target.earlyTerrainReasonCounts ??= {};
  for (const [reason, count] of Object.entries(source.earlyTerrainReasonCounts) as Array<[VegetationTerrainRejectionReason, number]>) {
    target.earlyTerrainReasonCounts[reason] = (target.earlyTerrainReasonCounts[reason] ?? 0) + count;
  }
}

function classKeyRow(cls: UnderstoryClassSettings): string {
  return `${cls.enabled ? 1 : 0}:${cls.weight}:${cls.density}:${cls.minScale}:${cls.maxScale}:${cls.heightPreference}:${cls.shadePreference}:${cls.moisturePreference}:${cls.forestEdgeBias}:${cls.windWeight}`;
}

export function understoryGpuRingKey(settings: UnderstorySettings, worldCells: number): string {
  const gpu = settings.gpu;
  const eco = settings.ecology;
  const cls = settings.classes;
  return [
    worldCells,
    settings.seed,
    settings.distanceM,
    gpu.maxVisible,
    gpu.workgroupSize,
    settings.placement.spacingM,
    settings.placement.slopeMinY,
    settings.placement.minHeightM,
    settings.placement.maxHeightM,
    settings.placement.minGroundWeight,
    settings.placement.minTreeInfluence,
    eco.enabled ? 1 : 0,
    eco.forestInfluenceScaleM,
    eco.forestEdgeWidthM,
    eco.clearingPreference,
    eco.moistureNoiseScaleM,
    eco.moistureStrength,
    eco.shadeStrength,
    eco.densityNoiseScaleM,
    eco.densityNoiseStrength,
    eco.deadfallOldForestBias,
    classKeyRow(cls.shrub),
    classKeyRow(cls.fern),
    classKeyRow(cls.sapling),
    classKeyRow(cls.flower),
    classKeyRow(cls.dead_log),
    classKeyRow(cls.stump),
    getDigEditRevision(),
  ].join(":");
}
