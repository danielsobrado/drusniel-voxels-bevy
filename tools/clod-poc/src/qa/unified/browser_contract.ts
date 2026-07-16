import type { CamPose, EngineStats } from "../../core/hooks.js";

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
  setPose(pose: CamPose): Promise<void>;
  setWorldState(state: QaWorldState): Promise<void>;
  settle(frames: number): Promise<void>;
  freeze(): Promise<void>;
  unfreeze(): Promise<void>;
  captureStats(): Promise<EngineStats>;
  captureScreenshot(name: string): Promise<string>;
  runCheckpoint(name: string): Promise<void>;
  lastCheckpoint(): string | null;
}

declare global {
  interface Window {
    __drusnielQa?: DrusnielQaHook;
  }
}
