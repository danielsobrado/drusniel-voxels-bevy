import { describe, expect, it } from "vitest";
import { StatsSyncThrottle, type StatsSyncThrottleInput } from "./stats_sync_throttle.js";

const config = {
  normalHz: 4,
  debugHz: 10,
  profileEveryFrame: true,
};

function input(overrides: Partial<StatsSyncThrottleInput> = {}): StatsSyncThrottleInput {
  return {
    nowMs: 0,
    frameIndex: 0,
    debugVisible: false,
    statsPanelVisible: false,
    profilingActive: false,
    gpuTimingActive: false,
    perfProbeActive: false,
    benchmarkActive: false,
    acceptanceActive: false,
    forceStatsSync: false,
    statsRevision: 0,
    ...overrides,
  };
}

describe("StatsSyncThrottle", () => {
  it("skips normal frames between 4 Hz intervals", () => {
    const throttle = new StatsSyncThrottle(config);
    expect(throttle.shouldRun(input({ nowMs: 0 })).shouldRun).toBe(true);
    expect(throttle.shouldRun(input({ nowMs: 100 })).reason).toBe("skipped");
    expect(throttle.shouldRun(input({ nowMs: 249 })).shouldRun).toBe(false);
    expect(throttle.shouldRun(input({ nowMs: 250 })).reason).toBe("normal");
  });

  it("debug mode uses the 10 Hz interval", () => {
    const throttle = new StatsSyncThrottle(config);
    expect(throttle.shouldRun(input({ nowMs: 0, debugVisible: true })).shouldRun).toBe(true);
    expect(throttle.shouldRun(input({ nowMs: 90, debugVisible: true })).shouldRun).toBe(false);
    expect(throttle.shouldRun(input({ nowMs: 100, debugVisible: true })).reason).toBe("debug");
  });

  it("profiling mode runs every frame", () => {
    const throttle = new StatsSyncThrottle(config);
    expect(throttle.shouldRun(input({ nowMs: 0, profilingActive: true })).reason).toBe("profile");
    expect(throttle.shouldRun(input({ nowMs: 1, profilingActive: true })).reason).toBe("profile");
  });

  it("GPU timing mode runs every frame", () => {
    const throttle = new StatsSyncThrottle(config);
    expect(throttle.shouldRun(input({ nowMs: 0, gpuTimingActive: true })).reason).toBe("profile");
    expect(throttle.shouldRun(input({ nowMs: 1, gpuTimingActive: true })).reason).toBe("profile");
  });

  it("perfProbe mode runs every frame", () => {
    const throttle = new StatsSyncThrottle(config);
    expect(throttle.shouldRun(input({ nowMs: 0, perfProbeActive: true })).reason).toBe("profile");
    expect(throttle.shouldRun(input({ nowMs: 1, perfProbeActive: true })).reason).toBe("profile");
  });

  it("acceptance and benchmark modes run every frame", () => {
    const benchmarkThrottle = new StatsSyncThrottle(config);
    expect(benchmarkThrottle.shouldRun(input({ nowMs: 0, benchmarkActive: true })).reason).toBe("profile");
    expect(benchmarkThrottle.shouldRun(input({ nowMs: 1, benchmarkActive: true })).reason).toBe("profile");

    const acceptanceThrottle = new StatsSyncThrottle(config);
    expect(acceptanceThrottle.shouldRun(input({ nowMs: 0, acceptanceActive: true })).reason).toBe("profile");
    expect(acceptanceThrottle.shouldRun(input({ nowMs: 1, acceptanceActive: true })).reason).toBe("profile");
  });

  it("force flag runs immediately", () => {
    const throttle = new StatsSyncThrottle(config);
    expect(throttle.shouldRun(input({ nowMs: 0 })).shouldRun).toBe(true);
    expect(throttle.shouldRun(input({ nowMs: 10, forceStatsSync: true })).reason).toBe("forced");
  });

  it("debug visibility change runs immediately", () => {
    const throttle = new StatsSyncThrottle(config);
    expect(throttle.shouldRun(input({ nowMs: 0 })).shouldRun).toBe(true);
    expect(throttle.shouldRun(input({ nowMs: 10, debugVisible: true })).reason).toBe("debug");
  });

  it("stats revision change runs immediately", () => {
    const throttle = new StatsSyncThrottle(config);
    expect(throttle.shouldRun(input({ nowMs: 0, statsRevision: 1 })).shouldRun).toBe(true);
    expect(throttle.shouldRun(input({ nowMs: 10, statsRevision: 2 })).reason).toBe("revision");
  });

  it("after a forced run, the next normal run respects the interval", () => {
    const throttle = new StatsSyncThrottle(config);
    expect(throttle.shouldRun(input({ nowMs: 0 })).shouldRun).toBe(true);
    expect(throttle.shouldRun(input({ nowMs: 50, forceStatsSync: true })).reason).toBe("forced");
    expect(throttle.shouldRun(input({ nowMs: 299 })).shouldRun).toBe(false);
    expect(throttle.shouldRun(input({ nowMs: 300 })).reason).toBe("normal");
  });
});
