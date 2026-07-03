export interface StatsSyncThrottleConfig {
  normalHz: number;
  debugHz: number;
  profileEveryFrame: boolean;
}

export interface StatsSyncThrottleInput {
  nowMs: number;
  frameIndex: number;
  debugVisible: boolean;
  statsPanelVisible: boolean;
  profilingActive: boolean;
  gpuTimingActive: boolean;
  perfProbeActive: boolean;
  benchmarkActive: boolean;
  acceptanceActive: boolean;
  forceStatsSync: boolean;
  statsRevision: number;
}

export type StatsSyncThrottleReason =
  | "profile"
  | "debug"
  | "normal"
  | "forced"
  | "revision"
  | "skipped";

export interface StatsSyncThrottleDecision {
  shouldRun: boolean;
  reason: StatsSyncThrottleReason;
}

export interface StatsSyncThrottleDiagnostics {
  runs: number;
  skips: number;
  skippedFrames: number;
  effectiveHz: number;
  lastReason: StatsSyncThrottleReason;
  lastRunFrameIndex: number;
}

export const STATS_SYNC_THROTTLE_REASON_CODE: Record<StatsSyncThrottleReason, number> = {
  skipped: 0,
  profile: 1,
  debug: 2,
  normal: 3,
  forced: 4,
  revision: 5,
};

export class StatsSyncThrottle {
  private lastRunAtMs = -Infinity;
  private lastStatsRevision: number | null = null;
  private lastDebugVisible: boolean | null = null;
  private lastStatsPanelVisible: boolean | null = null;
  private runs = 0;
  private skips = 0;
  private skippedFrames = 0;
  private lastRunIntervalMs = 0;
  private lastReason: StatsSyncThrottleReason = "skipped";
  private lastRunFrameIndex = -1;

  constructor(private readonly config: StatsSyncThrottleConfig) {}

  shouldRun(input: StatsSyncThrottleInput): StatsSyncThrottleDecision {
    if (this.config.profileEveryFrame && this.profileMode(input)) {
      return this.recordRun(input, "profile");
    }
    if (input.forceStatsSync) {
      return this.recordRun(input, "forced");
    }
    if (this.visibilityChanged(input)) {
      return this.recordRun(input, "debug");
    }
    if (this.lastStatsRevision === null || input.statsRevision !== this.lastStatsRevision) {
      return this.recordRun(input, "revision");
    }

    const intervalMs = 1000 / Math.max(0.001, input.debugVisible || input.statsPanelVisible ? this.config.debugHz : this.config.normalHz);
    if (input.nowMs - this.lastRunAtMs >= intervalMs) {
      return this.recordRun(input, input.debugVisible || input.statsPanelVisible ? "debug" : "normal");
    }

    this.skips += 1;
    this.skippedFrames += 1;
    this.lastReason = "skipped";
    return { shouldRun: false, reason: "skipped" };
  }

  diagnostics(): StatsSyncThrottleDiagnostics {
    return {
      runs: this.runs,
      skips: this.skips,
      skippedFrames: this.skippedFrames,
      effectiveHz: this.lastRunIntervalMs > 0 ? 1000 / this.lastRunIntervalMs : 0,
      lastReason: this.lastReason,
      lastRunFrameIndex: this.lastRunFrameIndex,
    };
  }

  private profileMode(input: StatsSyncThrottleInput): boolean {
    return input.profilingActive || input.gpuTimingActive || input.perfProbeActive || input.benchmarkActive || input.acceptanceActive;
  }

  private visibilityChanged(input: StatsSyncThrottleInput): boolean {
    return (this.lastDebugVisible !== null && input.debugVisible !== this.lastDebugVisible)
      || (this.lastStatsPanelVisible !== null && input.statsPanelVisible !== this.lastStatsPanelVisible);
  }

  private recordRun(input: StatsSyncThrottleInput, reason: StatsSyncThrottleReason): StatsSyncThrottleDecision {
    if (Number.isFinite(this.lastRunAtMs)) {
      this.lastRunIntervalMs = Math.max(0, input.nowMs - this.lastRunAtMs);
    }
    this.lastRunAtMs = input.nowMs;
    this.lastStatsRevision = input.statsRevision;
    this.lastDebugVisible = input.debugVisible;
    this.lastStatsPanelVisible = input.statsPanelVisible;
    this.lastRunFrameIndex = input.frameIndex;
    this.skippedFrames = 0;
    this.runs += 1;
    this.lastReason = reason;
    return { shouldRun: true, reason };
  }
}
