import { UNDERSTORY_CLASSES, type UnderstorySettings } from "./understory_config.js";
import {
  understoryRingAcceptance,
  understoryRingAcceptParams,
  understoryRingCell,
  understoryRingGrid,
  understoryRingHash,
  understoryRingSlotCount,
  understoryRingTerrainGate,
  understoryWorldCellFromSlot,
  type UnderstoryRingCounts,
} from "./understory_ring_math.js";
import { sampleUnderstoryEcology, understoryClassWeight } from "./understory_ecology.js";
import type { UnderstoryTerrainSampler } from "./understory_instances.js";
import { defaultUnderstoryTerrainSampler } from "./understory_instances.js";

export interface UnderstoryRingValidationCounts {
  counts: UnderstoryRingCounts;
  groupCounts: number[];
  overflowed: boolean;
  candidateCount: number;
  acceptedCandidates: number;
}

export interface UnderstoryRingValidationOptions {
  centerX: number;
  centerZ: number;
  worldCells: number;
  settings: UnderstorySettings;
  sampler?: UnderstoryTerrainSampler;
  maxInstancesPerGroup: number;
  frustumPlanes?: ArrayLike<number>;
}

export function generateUnderstoryRingValidationCounts(
  options: UnderstoryRingValidationOptions,
): UnderstoryRingValidationCounts {
  const counts: UnderstoryRingCounts = { shrub: 0, fern: 0, sapling: 0, flower: 0, dead_log: 0, stump: 0 };
  const rawGroupCounts = new Array<number>(UNDERSTORY_CLASSES.length).fill(0);
  if (!options.settings.enabled) {
    return { counts, groupCounts: rawGroupCounts, overflowed: false, candidateCount: 0, acceptedCandidates: 0 };
  }

  const sampler = options.sampler ?? defaultUnderstoryTerrainSampler;
  const settings = options.settings;
  const grid = understoryRingGrid(settings);
  const slots = understoryRingSlotCount(settings);
  const acceptParams = understoryRingAcceptParams(settings);
  const maxInstancesPerGroup = Math.max(0, Math.floor(options.maxInstancesPerGroup));
  const cellSize = understoryRingCell(settings);
  const worldMax = options.worldCells;
  let candidateCount = 0;
  let acceptedCandidates = 0;

  for (let slot = 0; slot < slots; slot++) {
    const wc = understoryWorldCellFromSlot(slot, grid, cellSize, options.centerX, options.centerZ);
    const jitterX = understoryRingHash(wc[0], wc[1], settings.seed, 1103);
    const jitterZ = understoryRingHash(wc[0], wc[1], settings.seed, 1200);
    const wx = (wc[0] + jitterX) * cellSize;
    const wz = (wc[1] + jitterZ) * cellSize;

    if (wx <= 0 || wz <= 0 || wx >= worldMax || wz >= worldMax) continue;
    const dist = Math.hypot(wx - options.centerX, wz - options.centerZ);
    if (dist > settings.distanceM) continue;

    candidateCount++;
    const height = sampler.surfaceHeight(wx, wz);
    const normalY = sampler.surfaceNormal(wx, wz)[1];

    const fp = options.frustumPlanes;
    if (fp && fp.length >= 24) {
      const cx = wx, cy = height + 4, cz = wz;
      let inFrustum = true;
      for (let p = 0; p < 6; p++) {
        const off = p * 4;
        const dot = fp[off] * cx + fp[off + 1] * cy + fp[off + 2] * cz + fp[off + 3];
        if (dot < -8) { inFrustum = false; break; }
      }
      if (!inFrustum) continue;
    }

    const ground = understoryRingTerrainGate(height, normalY, acceptParams);
    if (ground < 0) continue;

    const ecology = sampleUnderstoryEcology(wx, wz, height, normalY, ground, settings);
    const acceptance = understoryRingAcceptance(ecology);
    if (understoryRingHash(wc[0], wc[1], settings.seed, 809) >= acceptance) continue;
    if (ecology.forestInfluence < settings.placement.minTreeInfluence) continue;

    let totalWeight = 0;
    const weights = new Array<number>(UNDERSTORY_CLASSES.length);
    for (let g = 0; g < UNDERSTORY_CLASSES.length; g++) {
      weights[g] = understoryClassWeight(UNDERSTORY_CLASSES[g], ecology, height, normalY, settings);
      totalWeight += weights[g];
    }
    if (totalWeight <= 0) continue;

    const roll = understoryRingHash(wc[0], wc[1], settings.seed, 409) * totalWeight;
    let selectedGroup = 0;
    let cursor = roll;
    for (let g = 0; g < UNDERSTORY_CLASSES.length; g++) {
      cursor -= weights[g];
      if (cursor <= 0) {
        selectedGroup = g;
        break;
      }
    }

    const cls = UNDERSTORY_CLASSES[selectedGroup];
    const classDensity = settings.classes[cls].density;
    if (understoryRingHash(wc[0], wc[1], settings.seed, 509) > Math.min(1, classDensity)) continue;

    if (selectedGroup === 4 || selectedGroup === 5) {
      const parentX = Math.floor(wc[0] / 2);
      const parentZ = Math.floor(wc[1] / 2);
      const parentHash = fractalHash2(parentX, parentZ, settings.seed + 7777);
      if (parentHash > 0.55) continue;
    }

    acceptedCandidates++;
    rawGroupCounts[selectedGroup]++;
  }

  const groupCounts = rawGroupCounts.map((count) => Math.min(count, maxInstancesPerGroup));
  for (let group = 0; group < UNDERSTORY_CLASSES.length; group++) {
    counts[UNDERSTORY_CLASSES[group]] = groupCounts[group];
  }

  return {
    counts,
    groupCounts,
    overflowed: rawGroupCounts.some((count) => count > maxInstancesPerGroup),
    candidateCount,
    acceptedCandidates,
  };
}

function fractalHash2(cellX: number, cellZ: number, seed: number): number {
  const x = cellX + seed;
  const z = cellZ + seed * 0.37;
  return Math.abs(Math.sin(x * 41.3 + z * 289.1) * 43758.5453) % 1;
}
