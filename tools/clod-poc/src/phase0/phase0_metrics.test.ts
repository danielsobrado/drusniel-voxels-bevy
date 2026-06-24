import { describe, it, expect } from "vitest";
import {
  computeEffectiveVisibleMeters,
  computeVisibleTargetMet,
  summarizeAcceptance,
  buildDefaultMetrics,
} from "./phase0_metrics.js";
import { parsePhase0Config } from "./phase0_config.js";

const MINIMAL_CONFIG_YAML = `
phase0:
  target_visible_m: 4096
  target_future_visible_m: 8192
  streaming:
    preload_seconds: 4.0
    live_radius_m: 200
    clod_radius_m: 2048
  scenes:
    test_scene:
      world: 16
      camera:
        mode: fixed
      require_visible_m: 4096
metrics:
  required_counters:
    - world_cells
    - visible_target_met
acceptance:
  allow_current_4km_failure: true
  visible_target_required_for_future_phases: true
  max_horizon_hole_ratio: 0.0
  max_streamer_simulated_missing_chunks: 0
  max_streamer_simulated_missing_pages: 0
`;

describe("computeEffectiveVisibleMeters", () => {
  it("returns worldCells when shell disabled", () => {
    expect(computeEffectiveVisibleMeters({
      worldCells: 1024,
      farShellEnabled: false,
      farShellRadiusM: 1536,
    })).toBe(1024);
  });

  it("returns farShellRadiusM when shell enabled", () => {
    expect(computeEffectiveVisibleMeters({
      worldCells: 1024,
      farShellEnabled: true,
      farShellRadiusM: 1536,
    })).toBe(1536);
  });
});

describe("computeVisibleTargetMet", () => {
  it("returns false when effective < target", () => {
    expect(computeVisibleTargetMet({ effectiveVisibleM: 1536, targetVisibleM: 4096 })).toBe(false);
  });

  it("returns true when effective >= target", () => {
    expect(computeVisibleTargetMet({ effectiveVisibleM: 4096, targetVisibleM: 4096 })).toBe(true);
  });

  it("returns true when effective > target", () => {
    expect(computeVisibleTargetMet({ effectiveVisibleM: 5000, targetVisibleM: 4096 })).toBe(true);
  });
});

describe("summarizeAcceptance", () => {
  const config = parsePhase0Config(MINIMAL_CONFIG_YAML);

  it("marks visible_target_met=true when effective meets target", () => {
    const metrics = buildDefaultMetrics();
    metrics.effective_visible_m = 4096;
    metrics.target_visible_m = 4096;
    metrics.horizon_hole_ratio = 0;
    metrics.streamer_simulated_missing_chunks = 0;
    metrics.streamer_simulated_missing_pages = 0;
    const result = summarizeAcceptance({ metrics, config, sceneName: "test_scene" });
    expect(result.visible_target_met).toBe(true);
    expect(result.passed).toBe(true);
  });

  it("marks visible_target_met=false when effective < target", () => {
    const metrics = buildDefaultMetrics();
    metrics.effective_visible_m = 1536;
    metrics.target_visible_m = 4096;
    metrics.horizon_hole_ratio = 0;
    metrics.streamer_simulated_missing_chunks = 0;
    metrics.streamer_simulated_missing_pages = 0;
    const result = summarizeAcceptance({ metrics, config, sceneName: "test_scene" });
    expect(result.visible_target_met).toBe(false);
  });

  it("still passes when allow_current_4km_failure=true", () => {
    const metrics = buildDefaultMetrics();
    metrics.effective_visible_m = 1536;
    metrics.target_visible_m = 4096;
    metrics.horizon_hole_ratio = 0;
    metrics.streamer_simulated_missing_chunks = 0;
    metrics.streamer_simulated_missing_pages = 0;
    const result = summarizeAcceptance({ metrics, config, sceneName: "test_scene" });
    expect(result.passed).toBe(true);
  });

  it("reports missing counters", () => {
    const metrics = { world_cells: 1024 } as ReturnType<typeof buildDefaultMetrics>;
    const result = summarizeAcceptance({ metrics, config, sceneName: "test_scene" });
    expect(result.all_counters_present).toBe(false);
    expect(result.missing_counters).toContain("visible_target_met");
  });

  it("worldCells=1024, farShellRadiusM=1536, target=4096 => visible_target_met=false", () => {
    const metrics = buildDefaultMetrics();
    metrics.world_cells = 1024;
    metrics.effective_far_radius_m = 1536;
    metrics.effective_visible_m = computeEffectiveVisibleMeters({
      worldCells: 1024,
      farShellEnabled: true,
      farShellRadiusM: 1536,
    });
    expect(metrics.effective_visible_m).toBe(1536);
    expect(computeVisibleTargetMet({ effectiveVisibleM: 1536, targetVisibleM: 4096 })).toBe(false);
  });

  it("worldCells=2048, farShellRadiusM=3072, target=4096 => visible_target_met=false", () => {
    const effective = computeEffectiveVisibleMeters({
      worldCells: 2048,
      farShellEnabled: true,
      farShellRadiusM: 3072,
    });
    expect(effective).toBe(3072);
    expect(computeVisibleTargetMet({ effectiveVisibleM: 3072, targetVisibleM: 4096 })).toBe(false);
  });

  it("farShellRadiusM=4096, target=4096 => visible_target_met=true", () => {
    const effective = computeEffectiveVisibleMeters({
      worldCells: 1024,
      farShellEnabled: true,
      farShellRadiusM: 4096,
    });
    expect(effective).toBe(4096);
    expect(computeVisibleTargetMet({ effectiveVisibleM: 4096, targetVisibleM: 4096 })).toBe(true);
  });
});
