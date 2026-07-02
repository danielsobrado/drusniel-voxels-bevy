import type * as THREE from "three";
import type { ClodPageNode, PageFootprint } from "../types.js";
import {
  sampleTerrainVisibility,
  type TerrainHeightSampler,
  type VegetationVisibilityReason,
} from "../vegetation/vegetation_visibility_provider.js";
import type { TreeSettings } from "./tree_config.js";
import type { TreeTerrainSampler } from "./tree_instances.js";
import { treeFootprintCenterX, treeFootprintCenterZ, treeFootprintRadius } from "./tree_system_math.js";

export type TreeEarlyTerrainRejectionReason = VegetationVisibilityReason | "not_tested";

export interface TreeEarlyTerrainRejectionStats {
  testedPatches: number;
  rejectedPatches: number;
  acceptedPatches: number;
  unknownKeptPatches: number;
  skippedCandidateEstimate: number;
  reasonCounts: Record<TreeEarlyTerrainRejectionReason, number>;
}

export interface TreeEarlyTerrainRejectionDecision {
  reject: boolean;
  reason: TreeEarlyTerrainRejectionReason;
  skippedCandidateEstimate: number;
}

export interface TreeEarlyTerrainRejectionInput {
  node: ClodPageNode;
  settings: TreeSettings;
  sampler: TreeTerrainSampler | undefined;
  cameraPosition: THREE.Vector3;
  worldCells: number;
}

interface FootprintProbe {
  x: number;
  z: number;
}

export function createEmptyTreeEarlyTerrainRejectionStats(): TreeEarlyTerrainRejectionStats {
  return {
    testedPatches: 0,
    rejectedPatches: 0,
    acceptedPatches: 0,
    unknownKeptPatches: 0,
    skippedCandidateEstimate: 0,
    reasonCounts: createReasonCounts(),
  };
}

export function resetTreeEarlyTerrainRejectionStats(stats: TreeEarlyTerrainRejectionStats): void {
  stats.testedPatches = 0;
  stats.rejectedPatches = 0;
  stats.acceptedPatches = 0;
  stats.unknownKeptPatches = 0;
  stats.skippedCandidateEstimate = 0;
  for (const reason of Object.keys(stats.reasonCounts) as TreeEarlyTerrainRejectionReason[]) {
    stats.reasonCounts[reason] = 0;
  }
}

export function rejectTreePatchBeforeGeneration(input: TreeEarlyTerrainRejectionInput): TreeEarlyTerrainRejectionDecision {
  const visibility = input.settings.gpu.terrainVisibility;
  if (!input.settings.enabled || !visibility.enabled) return accept("disabled");
  const terrainSampler = createTerrainHeightSampler(input.sampler);
  if (!terrainSampler) return accept("unknown_kept");

  const probes = footprintProbes(input.node.footprint, input.cameraPosition);
  let hiddenProbeCount = 0;
  for (const probe of probes) {
    if (!probeInsideWorld(probe, input.worldCells)) return accept("unknown_kept");
    const targetSample = terrainSampler.sampleHeight(probe.x, probe.z);
    if (targetSample.unknown || !Number.isFinite(targetSample.height)) return accept("unknown_kept");

    const result = sampleTerrainVisibility({
      sampler: terrainSampler,
      settings: {
        enabled: true,
        minDistanceM: visibility.minDistanceM,
        sampleCount: visibility.sampleCount,
        heightMarginM: visibility.heightMarginM,
        crownHeightM: visibility.crownHeightM,
      },
      cameraX: input.cameraPosition.x,
      cameraY: input.cameraPosition.y,
      cameraZ: input.cameraPosition.z,
      targetX: probe.x,
      targetZ: probe.z,
      targetGroundY: targetSample.height,
      targetRadiusM: treeFootprintRadius(input.node.footprint),
    });

    if (result.visible) return accept(result.reason);
    hiddenProbeCount++;
  }

  if (hiddenProbeCount !== probes.length) return accept("visible");
  return {
    reject: true,
    reason: "terrain_hidden",
    skippedCandidateEstimate: estimateTreePatchCandidateCount(input.node.footprint, input.settings),
  };
}

export function recordTreeEarlyTerrainRejection(
  stats: TreeEarlyTerrainRejectionStats | undefined,
  decision: TreeEarlyTerrainRejectionDecision,
): void {
  if (!stats) return;
  stats.testedPatches++;
  stats.reasonCounts[decision.reason]++;
  if (decision.reason === "unknown_kept") stats.unknownKeptPatches++;
  if (decision.reject) {
    stats.rejectedPatches++;
    stats.skippedCandidateEstimate += Math.max(0, Math.floor(decision.skippedCandidateEstimate));
  } else {
    stats.acceptedPatches++;
  }
}

export function estimateTreePatchCandidateCount(footprint: PageFootprint, settings: TreeSettings): number {
  const spacing = Math.max(0.5, settings.placement.spacingM);
  const columns = Math.max(0, Math.floor((footprint.maxX - footprint.minX) / spacing));
  const rows = Math.max(0, Math.floor((footprint.maxZ - footprint.minZ) / spacing));
  return columns * rows;
}

function accept(reason: TreeEarlyTerrainRejectionReason): TreeEarlyTerrainRejectionDecision {
  return { reject: false, reason, skippedCandidateEstimate: 0 };
}

function createTerrainHeightSampler(sampler: TreeTerrainSampler | undefined): TerrainHeightSampler | undefined {
  if (!sampler) return undefined;
  return {
    sampleHeight: (x, z) => {
      const height = sampler.surfaceHeight(x, z);
      return { height, unknown: !Number.isFinite(height) };
    },
  };
}

function footprintProbes(footprint: PageFootprint, cameraPosition: THREE.Vector3): FootprintProbe[] {
  const center = { x: treeFootprintCenterX(footprint), z: treeFootprintCenterZ(footprint) };
  const corners: FootprintProbe[] = [
    { x: footprint.minX, z: footprint.minZ },
    { x: footprint.minX, z: footprint.maxZ },
    { x: footprint.maxX, z: footprint.minZ },
    { x: footprint.maxX, z: footprint.maxZ },
  ];
  corners.sort((a, b) => distanceSq(a, cameraPosition) - distanceSq(b, cameraPosition));
  return dedupeProbes([corners[0] ?? center, center, ...corners]);
}

function dedupeProbes(probes: FootprintProbe[]): FootprintProbe[] {
  const result: FootprintProbe[] = [];
  const seen = new Set<string>();
  for (const probe of probes) {
    const key = `${probe.x.toFixed(4)}|${probe.z.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(probe);
  }
  return result;
}

function distanceSq(probe: FootprintProbe, cameraPosition: THREE.Vector3): number {
  const dx = probe.x - cameraPosition.x;
  const dz = probe.z - cameraPosition.z;
  return dx * dx + dz * dz;
}

function probeInsideWorld(probe: FootprintProbe, worldCells: number): boolean {
  return probe.x >= 0 && probe.z >= 0 && probe.x <= worldCells && probe.z <= worldCells;
}

function createReasonCounts(): Record<TreeEarlyTerrainRejectionReason, number> {
  return {
    visible: 0,
    terrain_hidden: 0,
    unknown_kept: 0,
    near_forced_visible: 0,
    disabled: 0,
    not_tested: 0,
  };
}
