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

export interface VegetationFarSummaryRejectResult {
  decision: VegetationFarSummaryRejectDecision | null;
  consulted: boolean;
}

export interface VegetationFarSummaryRejectProvider {
  classifyCluster(query: VegetationTerrainRejectQuery): VegetationFarSummaryRejectResult;
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
  /** Infinite/island world: there is real terrain past [0, worldCells], so skip the box reject. */
  unbounded?: boolean;
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
  farSummaryConsulted?: boolean;
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
      if (revisionMismatch(query)) return unknownSummaryDecision(query, "conservativeFallback", query.acceptWhenRevisionMismatch);

      let farSummaryConsulted = false;
      const sourcePriority = query.sourcePriority ?? defaultPriority;
      for (const source of sourcePriority) {
        if (source === "naadfFarSummary") {
          const result = farSummaryProvider?.classifyCluster(query) ?? { decision: null, consulted: false };
          farSummaryConsulted ||= result.consulted;
          if (result.decision) return farSummaryDecision(query, result.decision, source, farSummaryConsulted);
          continue;
        }
        if (source === "terrainVisibilitySampler") {
          const decision = classifyWithTerrainSampler(query, visibilityProvider);
          if (decision) return withFarSummaryConsulted(decision, farSummaryConsulted);
          continue;
        }
        return unknownSummaryDecision(query, "conservativeFallback", undefined, farSummaryConsulted);
      }

      return unknownSummaryDecision(query, "conservativeFallback", undefined, farSummaryConsulted);
    },
  };
}

function classifyWithTerrainSampler(
  query: VegetationTerrainRejectQuery,
  visibilityProvider: ReturnType<typeof createVegetationVisibilityProvider>,
): VegetationTerrainRejectDecision | null {
  if (!query.sampler) return null;

  const sample = query.sampler.sampleHeight(query.descriptor.centerX, query.descriptor.centerZ);
  if (!sample || sample.unknown || !Number.isFinite(sample.height)) {
    return unknownSummaryDecision(query, "terrainVisibilitySampler");
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
    return reject("terrainHidden", "fallback", "terrainVisibilitySampler", visibility.reason);
  }
  if (visibility.reason === "unknown_kept") return unknownSummaryDecision(query, "terrainVisibilitySampler");
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
    classifyCluster(query): VegetationFarSummaryRejectResult {
      const field = getField();
      if (!field) return { decision: null, consulted: false };
      const { centerX, centerZ } = query.descriptor;
      const coverage = sampleCoverage(field, centerX, centerZ);
      const heightMin = sampleHeightBlend(field, centerX, centerZ, 0);
      const heightMax = sampleHeightBlend(field, centerX, centerZ, 1);
      const debug = { coverage, heightMin, heightMax };

      if (!Number.isFinite(heightMin) || !Number.isFinite(heightMax)) {
        return {
          consulted: true,
          decision: { reject: false, reason: "summaryMissing", confidence: "summary", debug, sourceReason: "unknown_kept" },
        };
      }
      if (coverage < (query.minCoverageToAccept ?? 0.05)) {
        return {
          consulted: true,
          decision: { reject: true, reason: "noCoverage", confidence: "summary", debug },
        };
      }
      if (!query.sampler) {
        return {
          consulted: true,
          decision: { reject: false, reason: "accepted", confidence: "summary", debug, sourceReason: "visible" },
        };
      }

      return { decision: null, consulted: true };
    },
  };
}

function farSummaryDecision(
  query: VegetationTerrainRejectQuery,
  decision: VegetationFarSummaryRejectDecision,
  source: VegetationTerrainRejectSource,
  farSummaryConsulted: boolean,
): VegetationTerrainRejectDecision {
  if (decision.reason !== "summaryMissing") return withFarSummaryConsulted({ ...decision, source }, farSummaryConsulted);
  const conservative = unknownSummaryDecision(query, source, undefined, farSummaryConsulted);
  return {
    ...conservative,
    confidence: decision.confidence,
    debug: decision.debug,
    sourceReason: decision.sourceReason,
  };
}

function unknownSummaryDecision(
  query: VegetationTerrainRejectQuery,
  source: VegetationTerrainRejectSource,
  acceptWhenMissing = query.acceptWhenSummaryMissing,
  farSummaryConsulted = false,
): VegetationTerrainRejectDecision {
  if (acceptWhenMissing === false) return reject("summaryMissing", "fallback", source, "unknown_kept", undefined, farSummaryConsulted);
  return accept("summaryMissing", "fallback", source, "unknown_kept", undefined, farSummaryConsulted);
}

function accept(
  reason: VegetationTerrainRejectReason,
  confidence: VegetationTerrainRejectConfidence,
  source: VegetationTerrainRejectSource,
  sourceReason?: VegetationVisibilityReason,
  debug?: VegetationTerrainRejectDebugValues,
  farSummaryConsulted = false,
): VegetationTerrainRejectDecision {
  return withFarSummaryConsulted({ reject: false, reason, confidence, source, sourceReason, debug }, farSummaryConsulted);
}

function reject(
  reason: VegetationTerrainRejectReason,
  confidence: VegetationTerrainRejectConfidence,
  source: VegetationTerrainRejectSource,
  sourceReason?: VegetationVisibilityReason,
  debug?: VegetationTerrainRejectDebugValues,
  farSummaryConsulted = false,
): VegetationTerrainRejectDecision {
  return withFarSummaryConsulted({ reject: true, reason, confidence, source, sourceReason, debug }, farSummaryConsulted);
}

function withFarSummaryConsulted(
  decision: VegetationTerrainRejectDecision,
  farSummaryConsulted: boolean,
): VegetationTerrainRejectDecision {
  return farSummaryConsulted ? { ...decision, farSummaryConsulted: true } : decision;
}

function outsideTerrain(query: VegetationTerrainRejectQuery): boolean {
  // Island worlds have terrain everywhere; the [0, worldCells] box only bounds a finite world.
  if (query.unbounded) return false;
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
