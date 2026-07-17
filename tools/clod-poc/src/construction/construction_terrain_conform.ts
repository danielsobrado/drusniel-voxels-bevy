import { constructionBoundsFor } from "./construction_bounds.js";
import type {
  ConstructionCandidate,
  ConstructionTerrainAabb,
  ConstructionTerrainConformConfig,
  ConstructionTerrainConformPreview,
  ConstructionTerrainConformRequest,
  ConstructionTerrainConformSample,
} from "./types.js";

const DEFAULT_SAMPLE_GRID = 3;
const TERRAIN_CHANGE_EPSILON_M = 0.01;
const DEPTH_TOLERANCE_M = 0.05;

function previewAabb(request: ConstructionTerrainConformRequest): ConstructionTerrainAabb {
  return {
    minX: request.footprint.minX,
    maxX: request.footprint.maxX,
    minY: request.footprint.targetY - request.fillDepthM,
    maxY: request.footprint.targetY + request.trimHeightM,
    minZ: request.footprint.minZ,
    maxZ: request.footprint.maxZ,
  };
}

export function createConstructionTerrainConformRequest(
  candidate: ConstructionCandidate,
  config: ConstructionTerrainConformConfig,
): ConstructionTerrainConformRequest | null {
  if (
    !config.enabled
    || !candidate.valid
    || candidate.snapped
    || !config.foundationCategories.includes(candidate.piece.category)
  ) return null;

  const bounds = constructionBoundsFor(candidate.piece, candidate.position, candidate.rotationQuarterTurns);
  return {
    pieceId: candidate.piece.id,
    position: candidate.position,
    dimensionsM: candidate.piece.dimensionsM,
    rotationQuarterTurns: candidate.rotationQuarterTurns,
    materialSlot: config.materialSlot,
    padMarginM: config.padMarginM,
    fillDepthM: config.fillDepthM,
    trimHeightM: config.trimHeightM,
    falloffM: config.falloffM,
    sampleGrid: DEFAULT_SAMPLE_GRID,
    footprint: {
      minX: bounds.minX - config.padMarginM,
      maxX: bounds.maxX + config.padMarginM,
      minZ: bounds.minZ - config.padMarginM,
      maxZ: bounds.maxZ + config.padMarginM,
      targetY: bounds.minY,
    },
  };
}

export function constructionTerrainSamplePositions(
  request: ConstructionTerrainConformRequest,
): readonly { x: number; z: number }[] {
  const grid = Math.max(2, Math.floor(request.sampleGrid));
  const width = request.footprint.maxX - request.footprint.minX;
  const depth = request.footprint.maxZ - request.footprint.minZ;
  const insetX = Math.min(width * 0.08, 0.15);
  const insetZ = Math.min(depth * 0.08, 0.15);
  const minX = request.footprint.minX + insetX;
  const maxX = request.footprint.maxX - insetX;
  const minZ = request.footprint.minZ + insetZ;
  const maxZ = request.footprint.maxZ - insetZ;
  const positions: Array<{ x: number; z: number }> = [];
  for (let zIndex = 0; zIndex < grid; zIndex += 1) {
    const zT = grid === 1 ? 0.5 : zIndex / (grid - 1);
    for (let xIndex = 0; xIndex < grid; xIndex += 1) {
      const xT = grid === 1 ? 0.5 : xIndex / (grid - 1);
      positions.push({
        x: minX + (maxX - minX) * xT,
        z: minZ + (maxZ - minZ) * zT,
      });
    }
  }
  return positions;
}

export function invalidConstructionTerrainPreview(
  request: ConstructionTerrainConformRequest,
  reason: string,
  samples: readonly ConstructionTerrainConformSample[] = [],
): ConstructionTerrainConformPreview {
  const surfaceValues = samples.map((sample) => sample.surfaceY);
  return {
    valid: false,
    reason,
    changed: false,
    targetY: request.footprint.targetY,
    sampleCount: samples.length,
    samples,
    minSurfaceY: surfaceValues.length > 0 ? Math.min(...surfaceValues) : request.footprint.targetY,
    maxSurfaceY: surfaceValues.length > 0 ? Math.max(...surfaceValues) : request.footprint.targetY,
    maxFillDepthM: 0,
    maxCutHeightM: 0,
    fillVolumeM3: 0,
    cutVolumeM3: 0,
    worldAabb: previewAabb(request),
  };
}

export function analyzeConstructionTerrainSamples(
  request: ConstructionTerrainConformRequest,
  samples: readonly Omit<ConstructionTerrainConformSample, "deltaY">[],
): ConstructionTerrainConformPreview {
  const expectedSamples = Math.max(2, Math.floor(request.sampleGrid)) ** 2;
  if (samples.length !== expectedSamples) {
    return invalidConstructionTerrainPreview(request, "terrain footprint is not fully authoritative");
  }

  const normalized: ConstructionTerrainConformSample[] = samples.map((sample) => ({
    ...sample,
    deltaY: request.footprint.targetY - sample.surfaceY,
  }));
  const fillDepths = normalized.map((sample) => Math.max(0, sample.deltaY));
  const cutHeights = normalized.map((sample) => Math.max(0, -sample.deltaY));
  const maxFillDepthM = Math.max(...fillDepths);
  const maxCutHeightM = Math.max(...cutHeights);
  if (maxFillDepthM > request.fillDepthM + DEPTH_TOLERANCE_M) {
    return {
      ...invalidConstructionTerrainPreview(
        request,
        `terrain fill requires ${maxFillDepthM.toFixed(2)}m; limit is ${request.fillDepthM.toFixed(2)}m`,
        normalized,
      ),
      maxFillDepthM,
      maxCutHeightM,
    };
  }
  if (maxCutHeightM > request.trimHeightM + DEPTH_TOLERANCE_M) {
    return {
      ...invalidConstructionTerrainPreview(
        request,
        `terrain cut requires ${maxCutHeightM.toFixed(2)}m; limit is ${request.trimHeightM.toFixed(2)}m`,
        normalized,
      ),
      maxFillDepthM,
      maxCutHeightM,
    };
  }

  const areaM2 = Math.max(0, request.footprint.maxX - request.footprint.minX)
    * Math.max(0, request.footprint.maxZ - request.footprint.minZ);
  const average = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    valid: true,
    reason: null,
    changed: maxFillDepthM > TERRAIN_CHANGE_EPSILON_M || maxCutHeightM > TERRAIN_CHANGE_EPSILON_M,
    targetY: request.footprint.targetY,
    sampleCount: normalized.length,
    samples: normalized,
    minSurfaceY: Math.min(...normalized.map((sample) => sample.surfaceY)),
    maxSurfaceY: Math.max(...normalized.map((sample) => sample.surfaceY)),
    maxFillDepthM,
    maxCutHeightM,
    fillVolumeM3: areaM2 * average(fillDepths),
    cutVolumeM3: areaM2 * average(cutHeights),
    worldAabb: previewAabb(request),
  };
}
