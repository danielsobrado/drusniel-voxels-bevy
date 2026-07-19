import type { CamPose } from "../../src/core/hooks.js";

export type VisualSequenceMode = "static" | "transition" | "paired" | "moving";

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
  thresholds?: VisualSequenceThresholds;
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
  if (!Number.isFinite(config.stepSeconds) || Number(config.stepSeconds) <= 0) throw new Error("stepSeconds must be positive");
  if (!config.start || !config.end) throw new Error("sequence start and end poses are required");
  if (config.thresholds) {
    for (const [name, threshold] of Object.entries(config.thresholds)) {
      if (name === "counterMax") {
        for (const [counter, maximum] of Object.entries(threshold as Record<string, number>)) {
          if (!Number.isFinite(maximum) || maximum < 0) throw new Error(`threshold counterMax.${counter} must be non-negative`);
        }
        continue;
      }
      if (!Number.isFinite(threshold) || threshold < 0) throw new Error(`threshold ${name} must be non-negative`);
    }
  }
  return config as VisualSequenceConfig;
}
