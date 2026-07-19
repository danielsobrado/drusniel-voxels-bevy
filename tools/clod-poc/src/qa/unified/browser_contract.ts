import type { CamPose, EngineStats } from "../../core/hooks.js";
import type { SequenceClockConfig, SequenceClockState } from "../sequence/sequence_clock.js";

export interface QaEnvironment {
  userAgent: string;
  platform: string;
  viewport: [number, number];
  devicePixelRatio: number;
  gpu: Record<string, unknown> | null;
}

export interface QaWorldState {
  freeze?: boolean;
  proceduralDebug?: string | null;
}

export interface DrusnielQaHook {
  schemaVersion: 1;
  ready(): boolean;
  readinessBlockers(): string[];
  error(): string | null;
  environment(): QaEnvironment;
  getPose(): CamPose;
  getCameraMatrices(): { viewProjection: number[]; viewProjectionInverse: number[]; near: number; far: number };
  setPose(pose: CamPose): Promise<void>;
  setWorldState(state: QaWorldState): Promise<void>;
  settle(frames: number): Promise<void>;
  freeze(): Promise<void>;
  unfreeze(): Promise<void>;
  captureStats(): Promise<EngineStats>;
  captureScreenshot(name: string): Promise<string>;
  runCheckpoint(name: string): Promise<void>;
  lastCheckpoint(): string | null;
  beginSequence(config: SequenceClockConfig): Promise<void>;
  stepSequence(index: number): Promise<SequenceClockState>;
  endSequence(): Promise<void>;
  captureDiagnosticBuffer(kind: "final" | "depth"): Promise<string>;
  setDiagnosticBuffer(kind: "final" | "depth"): Promise<void>;
  runSequenceEvent(action: "streaming-off" | "streaming-on" | "ownership-debug" | "final-debug"): Promise<void>;
}

declare global {
  interface Window {
    __drusnielQa?: DrusnielQaHook;
  }
}
