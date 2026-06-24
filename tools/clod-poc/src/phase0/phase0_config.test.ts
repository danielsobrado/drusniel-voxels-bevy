import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { parsePhase0Config } from "./phase0_config.js";

const VALID_YAML = `
phase0:
  target_visible_m: 4096
  target_future_visible_m: 8192
  scenes:
    long_view_4km:
      world: 16
      camera:
        mode: fixed
        x_ratio: 0.50
        z_ratio: 0.50
        y_offset_m: 260
        look_distance_m: 4096
      require_visible_m: 4096
    infinite_stream:
      world: 16
      camera:
        mode: scripted
        start_x_ratio: 0.20
        start_z_ratio: 0.50
        direction_degrees: 90
        speed_mps: 18
        duration_seconds: 20
        look_distance_m: 4096
      simulated_streaming_only: true
metrics:
  required_counters:
    - world_cells
    - target_visible_m
    - visible_target_met
acceptance:
  allow_current_4km_failure: true
  visible_target_required_for_future_phases: true
  max_horizon_hole_ratio: 0.0
  max_streamer_simulated_missing_chunks: 0
  max_streamer_simulated_missing_pages: 0
`;

describe("parsePhase0Config", () => {
  it("parses valid config", () => {
    const cfg = parsePhase0Config(VALID_YAML);
    expect(cfg.phase0.target_visible_m).toBe(4096);
    expect(cfg.phase0.target_future_visible_m).toBe(8192);
    expect(Object.keys(cfg.phase0.scenes)).toEqual(["long_view_4km", "infinite_stream"]);
    expect(cfg.phase0.scenes["long_view_4km"].world).toBe(16);
    expect(cfg.phase0.scenes["long_view_4km"].require_visible_m).toBe(4096);
    expect(cfg.phase0.scenes["infinite_stream"].simulated_streaming_only).toBe(true);
    expect(cfg.metrics.required_counters).toEqual(["world_cells", "target_visible_m", "visible_target_met"]);
    expect(cfg.acceptance.allow_current_4km_failure).toBe(true);
  });

  it("rejects missing root", () => {
    expect(() => parsePhase0Config("")).toThrow("root must be an object");
  });

  it("rejects missing phase0 section", () => {
    expect(() => parsePhase0Config("metrics:\n  required_counters:\n    - a\nacceptance:\n  allow_current_4km_failure: true\n  visible_target_required_for_future_phases: true\n  max_horizon_hole_ratio: 0\n  max_streamer_simulated_missing_chunks: 0\n  max_streamer_simulated_missing_pages: 0")).toThrow("missing 'phase0' section");
  });

  it("rejects target_visible_m <= 0", () => {
    const bad = VALID_YAML.replace("target_visible_m: 4096", "target_visible_m: 0");
    expect(() => parsePhase0Config(bad)).toThrow("target_visible_m");
  });

  it("rejects target_future_visible_m < target_visible_m", () => {
    const bad = VALID_YAML.replace("target_future_visible_m: 8192", "target_future_visible_m: 1000");
    expect(() => parsePhase0Config(bad)).toThrow("must be >=");
  });

  it("rejects scene with world <= 0", () => {
    const bad = VALID_YAML.replace("world: 16", "world: 0");
    expect(() => parsePhase0Config(bad)).toThrow("world");
  });

  it("rejects empty required_counters", () => {
    const bad = VALID_YAML.replace("- world_cells\n    - target_visible_m\n    - visible_target_met", "");
    expect(() => parsePhase0Config(bad)).toThrow("non-empty array");
  });

  it("rejects non-string counter names", () => {
    const bad = VALID_YAML.replace("- world_cells", "- 123");
    expect(() => parsePhase0Config(bad)).toThrow("must be a string");
  });

  it("parses the real config file", () => {
    const configPath = resolve(import.meta.dirname ?? ".", "../../config/infinite_streaming_phase0.yaml");
    const raw = readFileSync(configPath, "utf8");
    const cfg = parsePhase0Config(raw);
    expect(cfg.phase0.target_visible_m).toBe(4096);
    expect(cfg.phase0.target_future_visible_m).toBe(8192);
    expect(Object.keys(cfg.phase0.scenes)).toContain("long_view_4km");
    expect(cfg.metrics.required_counters.length).toBeGreaterThan(10);
    expect(cfg.acceptance.allow_current_4km_failure).toBe(true);
  });
});
