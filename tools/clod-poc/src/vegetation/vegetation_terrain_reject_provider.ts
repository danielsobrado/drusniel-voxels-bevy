import {
  createVegetationVisibilityProvider,
  type TerrainHeightSampler,
  type TerrainVisibilitySettings,
  type VegetationVisibilityReason,
} from "./vegetation_visibility_provider.js";
import type { VegetationClusterDescriptor, VegetationKind } from "./vegetation_cluster_descriptors.js";

export type VegetationTerrainRejectReason =
  | "outsideTerrain"
  | "terrainHidden"
  | "belowWaterOrInvalid"
  | "tooFarForKind"
  | "noCoverage"
  | "summaryMissing"
  | "accepted";

export type VegetationTerrainRejectConfidence = "exact" | "summary" | "fallback";

export interface VegetationTerrainRejectQuery {
  descriptor: VegetationClusterDescriptor;
  kind: VegetationKind;
  cameraX: number;
  cameraY: number;
  cameraZ: number;
  worldCells: number;
  visibility: TerrainVisibilitySettings;
  sampler?: TerrainHeightSampler;
  shadowPass?: boolean;
  terrainRevision?: number;
  providerRevision?: number;
  expectedTerrainRevision?: number;
  acceptWhenSummaryMissing?: boolean;
  acceptWhenRevisionMismatch?: boolean;
}

export interface VegetationTerrainRejectDecision {
  reject: boolean;
  reason: VegetationTerrainRejectReason;
  confidence: VegetationTerrainRejectConfidence;
  sourceReason?: VegetationVisibilityReason;
}

export interface VegetationTerrainRejectProvider {
  classifyCluster(query: VegetationTerrainRejectQuery): VegetationTerrainRejectDecision;
}

export function createVegetationTerrainRejectProvider(): VegetationTerrainRejectProvider {
  const visibilityProvider = createVegetationVisibilityProvider();
  return {
    classifyCluster(query): VegetationTerrainRejectDecision {
      if (!query.visibility.enabled) return accept("accepted", "fallback", "disabled");
      if (revisionMismatch(query)) return accept("summaryMissing", "fallback", "unknown_kept");
      if (outsideTerrain(query)) return reject("outsideTerrain", "exact");
      if (!query.sampler) return accept("summaryMissing", "fallback", "unknown_kept");

      const sample = query.sampler.sampleHeight(query.descriptor.centerX, query.descriptor.centerZ);
      if (!sample || sample.unknown || !Number.isFinite(sample.height)) {
        return accept("summaryMissing", "fallback", "unknown_kept");
      }

      const visibility = visibilityProvider.sampleTerrainVisibility({
        sampler: query.sampler,
        settings: query.visibility,
        cameraX: query.cameraX,
        cameraY: query.cameraY,
        cameraZ: query.cameraZ,
        targetX: query.descriptor.centerX,
        targetZ: query.descriptor.centerZ,
        targetGroundY: sample.height,
        targetRadiusM: Math.max(0, query.descriptor.halfSize),
      });
      if (!visibility.visible && visibility.reason === "terrain_hidden") {
        return reject("terrainHidden", "fallback", visibility.reason);
      }
      if (visibility.reason === "unknown_kept") return accept("summaryMissing", "fallback", visibility.reason);
      return accept("accepted", "fallback", visibility.reason);
    },
  };
}

function accept(
  reason: VegetationTerrainRejectReason,
  confidence: VegetationTerrainRejectConfidence,
  sourceReason?: VegetationVisibilityReason,
): VegetationTerrainRejectDecision {
  return { reject: false, reason, confidence, sourceReason };
}

function reject(
  reason: VegetationTerrainRejectReason,
  confidence: VegetationTerrainRejectConfidence,
  sourceReason?: VegetationVisibilityReason,
): VegetationTerrainRejectDecision {
  return { reject: true, reason, confidence, sourceReason };
}

function outsideTerrain(query: VegetationTerrainRejectQuery): boolean {
  const halfSize = Math.max(0, query.descriptor.halfSize);
  return query.descriptor.centerX + halfSize < 0 ||
    query.descriptor.centerZ + halfSize < 0 ||
    query.descriptor.centerX - halfSize > query.worldCells ||
    query.descriptor.centerZ - halfSize > query.worldCells;
}

function revisionMismatch(query: VegetationTerrainRejectQuery): boolean {
  if (query.expectedTerrainRevision === undefined || query.terrainRevision === undefined) return false;
  return query.expectedTerrainRevision !== query.terrainRevision;
}
