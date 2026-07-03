import { sampleCoverage, sampleHeightBlend } from "../clod/terrain_summary.js";
import type { TerrainSummaryField } from "../clod/terrain_summary_types.js";
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
  | "revisionMismatch"
  | "accepted";

export type VegetationTerrainRejectConfidence = "exact" | "summary" | "fallback";
export type VegetationTerrainRejectSource = "naadfFarSummary" | "terrainVisibilitySampler" | "conservativeFallback";

export interface VegetationTerrainRejectDebugValues {
  coverage?: number;
  waterCoverage?: number;
  heightMin?: number;
  heightMax?: number;
  revision?: number;
  tileId?: string;
}

export interface VegetationFarSummaryRejectDecision {
  reject: boolean;
  reason: VegetationTerrainRejectReason;
  confidence: Exclude<VegetationTerrainRejectConfidence, "fallback">;
  debug?: VegetationTerrainRejectDebugValues;
  sourceReason?: VegetationVisibilityReason;
}

export interface VegetationFarSummaryRejectProvider {
  classifyCluster(query: VegetationTerrainRejectQuery): VegetationFarSummaryRejectDecision | null;
}

export interface VegetationTerrainRejectProviderOptions {
  farSummaryProvider?: VegetationFarSummaryRejectProvider | null;
  sourcePriority?: readonly VegetationTerrainRejectSource[];
}

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
  minCoverageToAccept?: number;
  sourcePriority?: readonly VegetationTerrainRejectSource[];
}

export interface VegetationTerrainRejectDecision {
  reject: boolean;
  reason: VegetationTerrainRejectReason;
  confidence: VegetationTerrainRejectConfidence;
  source: VegetationTerrainRejectSource;
  sourceReason?: VegetationVisibilityReason;
  debug?: VegetationTerrainRejectDebugValues;
}

export interface VegetationTerrainRejectProvider {
  classifyCluster(query: VegetationTerrainRejectQuery): VegetationTerrainRejectDecision;
}

const DEFAULT_SOURCE_PRIORITY: readonly VegetationTerrainRejectSource[] = [
  "naadfFarSummary",
  "terrainVisibilitySampler",
  "conservativeFallback",
];

export function createVegetationTerrainRejectProvider(
  options: VegetationTerrainRejectProviderOptions = {},
): VegetationTerrainRejectProvider {
  const visibilityProvider = createVegetationVisibilityProvider();
  const farSummaryProvider = options.farSummaryProvider ?? createWindowFarSummaryRejectProvider();
  const defaultPriority = options.sourcePriority ?? DEFAULT_SOURCE_PRIORITY;

  return {
    classifyCluster(query): VegetationTerrainRejectDecision {
      if (!query.visibility.enabled) return accept("accepted", "fallback", "conservativeFallback", "disabled");
      if (outsideTerrain(query)) return reject("outsideTerrain", "exact", "conservativeFallback");
      if (revisionMismatch(query)) {
        return accept("revisionMismatch", "fallback", "conservativeFallback", "unknown_kept");
      }

      const sourcePriority = query.sourcePriority ?? defaultPriority;
      for (const source of sourcePriority) {
        if (source === "naadfFarSummary") {
          const decision = farSummaryProvider?.classifyCluster(query) ?? null;
          if (decision) return { ...decision, source };
          continue;
        }
        if (source === "terrainVisibilitySampler") {
          const decision = classifyWithTerrainSampler(query, visibilityProvider);
          if (decision) return decision;
          continue;
        }
        return accept("accepted", "fallback", "conservativeFallback", "unknown_kept");
      }

      return accept("accepted", "fallback", "conservativeFallback", "unknown_kept");
    },
  };
}

function classifyWithTerrainSampler(
  query: VegetationTerrainRejectQuery,
  visibilityProvider: ReturnType<typeof createVegetationVisibilityProvider>,
): VegetationTerrainRejectDecision | null {
  if (!query.sampler) return null;

  const sample = query.sampler.sampleHeight(query.descriptor.centerX, query.descriptor.centerZ);
  if (!sample || sample.unknown || !Number.isFinite(sample.height)) return null;

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
    return reject("terrainHidden", "fallback", "terrainVisibilitySampler", visibility.reason);
  }
  if (visibility.reason === "unknown_kept") {
    return accept("summaryMissing", "fallback", "terrainVisibilitySampler", visibility.reason);
  }
  return accept("accepted", "fallback", "terrainVisibilitySampler", visibility.reason);
}

function createWindowFarSummaryRejectProvider(): VegetationFarSummaryRejectProvider | null {
  if (typeof window === "undefined") return null;
  return createTerrainSummaryRejectProvider(() => window.__drusnielTerrainSummary ?? null);
}

export function createTerrainSummaryRejectProvider(
  getField: () => TerrainSummaryField | null | undefined,
): VegetationFarSummaryRejectProvider {
  return {
    classifyCluster(query): VegetationFarSummaryRejectDecision | null {
      const field = getField();
      if (!field) return null;
      const { centerX, centerZ } = query.descriptor;
      const coverage = sampleCoverage(field, centerX, centerZ);
      const heightMin = sampleHeightBlend(field, centerX, centerZ, 0);
      const heightMax = sampleHeightBlend(field, centerX, centerZ, 1);
      const debug = { coverage, heightMin, heightMax };

      if (!Number.isFinite(heightMin) || !Number.isFinite(heightMax)) {
        return { reject: false, reason: "summaryMissing", confidence: "summary", debug, sourceReason: "unknown_kept" };
      }
      if (coverage < (query.minCoverageToAccept ?? 0.05)) {
        return { reject: true, reason: "noCoverage", confidence: "summary", debug };
      }

      return null;
    },
  };
}

function accept(
  reason: VegetationTerrainRejectReason,
  confidence: VegetationTerrainRejectConfidence,
  source: VegetationTerrainRejectSource,
  sourceReason?: VegetationVisibilityReason,
  debug?: VegetationTerrainRejectDebugValues,
): VegetationTerrainRejectDecision {
  return { reject: false, reason, confidence, source, sourceReason, debug };
}

function reject(
  reason: VegetationTerrainRejectReason,
  confidence: VegetationTerrainRejectConfidence,
  source: VegetationTerrainRejectSource,
  sourceReason?: VegetationVisibilityReason,
  debug?: VegetationTerrainRejectDebugValues,
): VegetationTerrainRejectDecision {
  return { reject: true, reason, confidence, source, sourceReason, debug };
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
