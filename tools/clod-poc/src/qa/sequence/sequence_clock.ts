import type { CamPose } from "../../core/hooks.js";

export interface SequencePath {
  readonly start: CamPose;
  readonly end: CamPose;
}

export interface SequenceClockConfig {
  readonly frames: number;
  readonly stepSeconds: number;
  readonly path: SequencePath;
}

export interface SequenceClockState {
  readonly index: number;
  readonly timeSeconds: number;
  readonly pose: CamPose;
}

export class DeterministicSequenceClock {
  private readonly config: SequenceClockConfig;
  private nextIndex = 0;

  constructor(config: SequenceClockConfig) {
    if (!Number.isInteger(config.frames) || config.frames < 1) throw new Error("sequence frames must be a positive integer");
    if (!Number.isFinite(config.stepSeconds) || config.stepSeconds <= 0) throw new Error("sequence stepSeconds must be positive");
    this.config = config;
  }

  reset(): void {
    this.nextIndex = 0;
  }

  step(index = this.nextIndex): SequenceClockState {
    if (!Number.isInteger(index) || index < 0 || index >= this.config.frames) {
      throw new Error(`sequence frame ${index} is outside 0..${this.config.frames - 1}`);
    }
    this.nextIndex = index + 1;
    const t = this.config.frames === 1 ? 0 : index / (this.config.frames - 1);
    return {
      index,
      timeSeconds: index * this.config.stepSeconds,
      pose: interpolatePose(this.config.path.start, this.config.path.end, t),
    };
  }
}

export function interpolatePose(start: CamPose, end: CamPose, t: number): CamPose {
  const clamped = Math.max(0, Math.min(1, t));
  return {
    p: [
      lerp(start.p[0], end.p[0], clamped),
      lerp(start.p[1], end.p[1], clamped),
      lerp(start.p[2], end.p[2], clamped),
    ],
    yaw: lerpAngle(start.yaw, end.yaw, clamped),
    pitch: lerp(start.pitch, end.pitch, clamped),
    fov: lerp(start.fov ?? end.fov ?? 60, end.fov ?? start.fov ?? 60, clamped),
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  const delta = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + delta * t;
}
