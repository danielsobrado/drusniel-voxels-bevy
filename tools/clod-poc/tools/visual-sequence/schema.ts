import type { CamPose } from "../../src/core/hooks.js";

export type VisualSequenceMode = "static" | "transition" | "paired" | "moving";

export type VisualSequenceMaskSource = "sky-exclude" | "roi" | "ownership" | "coverage";

export type VisualSequenceRoi =
  | {
    type: "polyline";
    points: readonly [number, number, number][];
    radiusPx: number;
  }
  | {
    type: "annulus";
    center: readonly [number, number, number];
    innerRadiusPx: number;
    outerRadiusPx: number;
  };

export interface VisualSequencePairThresholds {
  maxMeanLuma?: number;
  maxChangedRatio?: number;
  maxEdgeMean?: number;
}

export interface VisualSequenceThresholds {
  meanLuma?: number;
  maxP95Luma?: number;
  maxChangedRatio?: number;
  popEvents?: number;
  eventMeanLuma?: number;
  eventP95Luma?: number;
  eventChangedRatio?: number;
  eventPopEvents?: number;
  maxReprojectedMeanLuma?: number;
  minReprojectedValidRatio?: number;
  minMaskCoverage?: number;
  maxMaskInstability?: number;
  counterMax?: Record<string, number>;
}

export interface VisualSequenceConfig {
  schemaVersion: 1;
  id: string;
  mode: VisualSequenceMode;
  frames: number;
  warmupFrames?: number;
  stepSeconds: number;
  scene: string;
  seed: number;
  boot?: CamPose;
  start: CamPose;
  end: CamPose;
  query: Record<string, string>;
  captureDepth: boolean;
  timeoutMs?: number;
  maskSources?: VisualSequenceMaskSource[];
  rois?: VisualSequenceRoi[];
  thresholds?: VisualSequenceThresholds;
  pairThresholds?: VisualSequencePairThresholds;
  eventFrame?: number;
  eventName?: string;
  setupAction?: "streaming-off" | "streaming-off-reset" | "ownership-debug";
  setupSettleFrames?: number;
  eventAction?: "streaming-on" | "final-debug";
}

export interface VisualSequenceFrameRecord {
  index: number;
  timeSeconds: number;
  pose: CamPose;
  color: string;
  depth?: string;
  ownership?: string;
  coverage?: string;
  stats: string;
}

export interface VisualSequenceManifest {
  schemaVersion: 1;
  id: string;
  mode: VisualSequenceMode;
  createdAt: string;
  commit: string;
  url: string;
  environment: Record<string, unknown>;
  config: VisualSequenceConfig;
  frames: VisualSequenceFrameRecord[];
}

export interface VisualSequenceEvent {
  frame: number;
  name: string;
  bounds: { x: number; y: number; width: number; height: number } | null;
  area: number;
  peakDelta: number;
  duration: number;
  counters: Record<string, number>;
}

const MASK_SOURCES = new Set<VisualSequenceMaskSource>(["sky-exclude", "roi", "ownership", "coverage"]);

export function validateVisualSequenceConfig(value: unknown): VisualSequenceConfig {
  if (!value || typeof value !== "object") throw new Error("sequence config must be an object");
  const config = value as Partial<VisualSequenceConfig>;
  if (config.schemaVersion !== 1) throw new Error("sequence config schemaVersion must be 1");
  if (!config.id?.trim()) throw new Error("sequence id is required");
  if (!(["static", "transition", "paired", "moving"] as const).includes(config.mode as VisualSequenceMode)) {
    throw new Error(`unsupported sequence mode: ${String(config.mode)}`);
  }
  if (!Number.isInteger(config.frames) || Number(config.frames) < 2 || Number(config.frames) > 96) {
    throw new Error("sequence frames must be an integer in 2..96");
  }
  if (config.warmupFrames !== undefined
    && (!Number.isInteger(config.warmupFrames) || Number(config.warmupFrames) < 0 || Number(config.warmupFrames) > 600)) {
    throw new Error("warmupFrames must be an integer in 0..600");
  }
  if (config.setupSettleFrames !== undefined
    && (!Number.isInteger(config.setupSettleFrames) || Number(config.setupSettleFrames) < 0 || Number(config.setupSettleFrames) > 600)) {
    throw new Error("setupSettleFrames must be an integer in 0..600");
  }
  if (config.timeoutMs !== undefined
    && (!Number.isFinite(config.timeoutMs) || Number(config.timeoutMs) < 1_000 || Number(config.timeoutMs) > 900_000)) {
    throw new Error("timeoutMs must be in 1000..900000");
  }
  if (!Number.isFinite(config.stepSeconds) || Number(config.stepSeconds) <= 0) throw new Error("stepSeconds must be positive");
  if (!config.start || !config.end) throw new Error("sequence start and end poses are required");
  if (config.maskSources) {
    if (!Array.isArray(config.maskSources)) throw new Error("maskSources must be an array");
    for (const source of config.maskSources) {
      if (!MASK_SOURCES.has(source as VisualSequenceMaskSource)) throw new Error(`unsupported maskSources entry: ${String(source)}`);
    }
  }
  if (config.rois) {
    if (!Array.isArray(config.rois)) throw new Error("rois must be an array");
    for (const [index, roi] of config.rois.entries()) validateRoi(roi, `rois[${index}]`);
  }
  if (config.thresholds) validateThresholdBag(config.thresholds, "threshold");
  if (config.pairThresholds) validateThresholdBag(config.pairThresholds, "pairThreshold");
  return config as VisualSequenceConfig;
}

function validateThresholdBag(bag: object, label: string): void {
  for (const [name, threshold] of Object.entries(bag)) {
    if (name === "counterMax") {
      for (const [counter, maximum] of Object.entries(threshold as Record<string, number>)) {
        if (!Number.isFinite(maximum) || maximum < 0) throw new Error(`${label} counterMax.${counter} must be non-negative`);
      }
      continue;
    }
    if (!Number.isFinite(threshold) || Number(threshold) < 0) throw new Error(`${label} ${name} must be non-negative`);
  }
}

function validateRoi(roi: unknown, path: string): void {
  if (!roi || typeof roi !== "object") throw new Error(`${path} must be an object`);
  const value = roi as Partial<VisualSequenceRoi> & { type?: string };
  if (value.type === "polyline") {
    if (!Array.isArray(value.points) || value.points.length < 2) throw new Error(`${path}.points must contain at least two world points`);
    for (const point of value.points) {
      if (!Array.isArray(point) || point.length !== 3 || point.some((axis) => !Number.isFinite(axis))) {
        throw new Error(`${path}.points entries must be [x,y,z]`);
      }
    }
    if (!Number.isFinite(value.radiusPx) || Number(value.radiusPx) < 0) throw new Error(`${path}.radiusPx must be non-negative`);
    return;
  }
  if (value.type === "annulus") {
    if (!Array.isArray(value.center) || value.center.length !== 3 || value.center.some((axis) => !Number.isFinite(axis))) {
      throw new Error(`${path}.center must be [x,y,z]`);
    }
    if (!Number.isFinite(value.innerRadiusPx) || Number(value.innerRadiusPx) < 0) throw new Error(`${path}.innerRadiusPx must be non-negative`);
    if (!Number.isFinite(value.outerRadiusPx) || Number(value.outerRadiusPx) < Number(value.innerRadiusPx)) {
      throw new Error(`${path}.outerRadiusPx must be >= innerRadiusPx`);
    }
    return;
  }
  throw new Error(`${path}.type must be polyline or annulus`);
}
