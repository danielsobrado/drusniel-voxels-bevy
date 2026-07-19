import type { CamPose } from "../../src/core/hooks.js";

export type VisualSequenceMode = "static" | "transition" | "paired" | "moving";

export interface VisualSequenceConfig {
  schemaVersion: 1;
  id: string;
  mode: VisualSequenceMode;
  frames: number;
  stepSeconds: number;
  scene: string;
  seed: number;
  start: CamPose;
  end: CamPose;
  query: Record<string, string>;
  captureDepth: boolean;
  eventFrame?: number;
  eventName?: string;
  setupAction?: "streaming-off" | "ownership-debug";
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
  if (!Number.isFinite(config.stepSeconds) || Number(config.stepSeconds) <= 0) throw new Error("stepSeconds must be positive");
  if (!config.start || !config.end) throw new Error("sequence start and end poses are required");
  return config as VisualSequenceConfig;
}
