import type { PlayerInteractionMode } from "../../player_controller.js";
import type { TreeStats } from "../../trees/index.js";
import type { PropGpuStatus } from "../../props/prop_types.js";
import type { FramePerfMetric } from "./perf_probe_constants.js";
import type { StatsSyncThrottleReason } from "./stats_sync_throttle.js";

export type { FramePerfMetric };
export type FramePerfBroadBucket = import("./perf_probe_constants.js").FramePerfBroadBucket;
export type FramePerfPropBucket = import("./perf_probe_constants.js").FramePerfPropBucket;

export interface FramePerfPhaseTiming {
  frameSetupMs: number;
  inputMs: number;
  selectionUpdateMs: number;
  clodApplyMs: number;
  longViewDiagnosticsMs: number;
  farSummaryMs: number;
  constructionMs: number;
  brushMs: number;
  combatMs: number;
  spellsMs: number;
  agentEnvelopeMs: number;
  terrainPhaseMs: number;
  shadowProxyMs: number;
  clodShadowMs: number;
  canopyMs: number;
  vegetationTotalMs: number;
  borderOceanDebugMs: number;
  statsSyncMs: number;
}

export interface FramePerfSample extends Record<FramePerfMetric, number> {
  frameId: number;
  renderedCount: number;
  terrainTriangles: number;
  chunkGroupsBuilt: number;
  nearFieldChunkGroups: number;
  interactionMode: PlayerInteractionMode;
  treeGpuStatus: TreeStats["gpuStatus"] | "unknown";
  treeGpuDispatchMs: number | null;
  customPropGpuStatus: PropGpuStatus | "unknown";
  customPropGpuDispatchMs: number | null;
  gpuPasses?: Record<string, number>;
  statsSyncThrottleReason: StatsSyncThrottleReason;
  [key: string]: number | string | boolean | null | undefined | Record<string, number>;
}

export interface FramePerfMetricStats {
  avg: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
}

export interface FramePerfBucketRank {
  name: string;
  p95: number;
  avg: number;
}

export interface FramePerfSummary {
  sampleCount: number;
  warmupFrames: number;
  targetSampleFrames: number;
  metrics: Record<FramePerfMetric, FramePerfMetricStats>;
  broadBucketsByP95: FramePerfBucketRank[];
  propBucketsByP95: FramePerfBucketRank[];
  counters: Record<string, any>;
}

export interface FramePerfSnapshot extends FramePerfSummary {
  ready: boolean;
  observedFrames: number;
  samples: FramePerfSample[];
  recentSamples: FramePerfSample[];
}

export interface FramePerfHooks {
  ready: boolean;
  observedFrames: number;
  sampleCount: number;
  warmupFrames: number;
  targetSampleFrames: number;
  lastSample: FramePerfSample | null;
  samples: FramePerfSample[];
  recentSamples: FramePerfSample[];
  snapshot: () => FramePerfSnapshot;
  reset: () => void;
}

export interface FramePerfProbe {
  readonly enabled: boolean;
  record(sample: FramePerfSample): void;
  reset(): void;
  snapshot(): FramePerfSnapshot;
}
