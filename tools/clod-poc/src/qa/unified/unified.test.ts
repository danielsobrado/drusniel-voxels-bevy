import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { WebQaCheckpoint } from "../qaTypes.js";
import { evaluateCounterGates } from "./counters.js";
import { compareImages } from "./image_metrics.js";
import { rec709Luminance, srgb8ToLinear, type LinearImage } from "./image_linear.js";
import { loadUnifiedRegistry } from "./manifest.js";
import { evaluateTimingGates } from "./timing.js";
import { readinessBlockers } from "./readiness.js";

const BASE_SCENE = `
  - id: smoke
    target: clod-poc
    lane: gpu
    enabled: true
    tags: [smoke]
    launch:
      world_seed: 1
      world_mode: finite
      scene: sanity
      quality: balanced
      render_resolution_preset: high
      viewport: [2560, 1440]
      device_pixel_ratio: 1
      camera: { position: [0, 10, 0], yaw_deg: 0, pitch_deg: 0, fov_y_deg: 55 }
      lighting: { time_of_day_hours: 12, sun_elevation_deg: 55, sun_azimuth_deg: 145 }
      weather: { wind_time_s: 0, cloud_time_s: 0, particle_time_s: 0, precipitation: none }
      flags: {}
    settle: { ready_timeout_ms: 1000, warmup_frames: 1, settle_frames: 1, freeze_after_settle: true }
    capture: { checkpoint: main, image: viewport, include_hud: false, include_debug_overlays: false }
    baseline:
      image: validation/baselines/clod-poc/smoke/baseline.png
      stats: validation/baselines/clod-poc/smoke/baseline.stats.json
      metrics: validation/baselines/clod-poc/smoke/baseline.metrics.json
      mask: null
      sha256: null
    image_gates:
      required: false
      changed_pixel_threshold: 0.05
      mean_absolute_error_max: 0.01
      p95_absolute_error_max: 0.04
      changed_pixel_fraction_max: 0.02
      edge_error_mean_max: 0.02
      luminance_mean_delta_max: 0.02
      luminance_stddev_delta_max: 0.02
      chroma_mean_delta_max: 0.02
    region_probes: []
    timing_gates: []
    counter_gates: []
    informational_metrics: []
    specialized_commands: []
`;

describe("unified QA manifests", () => {
  it("rejects unknown fields with an exact path", () => {
    const root = mkdtempSync(join(tmpdir(), "qa-manifest-"));
    const visual = join(root, "visual.yaml");
    const perf = join(root, "perf.yaml");
    writeFileSync(visual, `visual_regression:\n  schema_version: 1\n  baseline_version: 1\n  default_target: clod-poc\n  output_root: validation-runs\n  unknown: true\n  scenes: []\n`);
    writeFileSync(perf, `performance_regression:\n  schema_version: 1\n  default_target: clod-poc\n  output_root: validation-runs\n  scenes: []\n`);
    expect(() => loadUnifiedRegistry({ visual, performance: perf })).toThrow("visual_regression");
  });

  it("rejects duplicate scene IDs across manifests", () => {
    const root = mkdtempSync(join(tmpdir(), "qa-manifest-"));
    const visual = join(root, "visual.yaml");
    const perf = join(root, "perf.yaml");
    writeFileSync(visual, `visual_regression:\n  schema_version: 1\n  baseline_version: 1\n  default_target: clod-poc\n  output_root: validation-runs\n  scenes:\n${BASE_SCENE}`);
    writeFileSync(perf, `performance_regression:\n  schema_version: 1\n  default_target: clod-poc\n  output_root: validation-runs\n  scenes:\n${BASE_SCENE}`);
    expect(() => loadUnifiedRegistry({ visual, performance: perf })).toThrow("duplicate unified QA scene id");
  });
});

describe("linear image metrics", () => {
  it("uses exact sRGB and Rec.709 samples", () => {
    expect(srgb8ToLinear(0)).toBe(0);
    expect(srgb8ToLinear(255)).toBe(1);
    expect(rec709Luminance(1, 1, 1)).toBeCloseTo(1, 10);
  });

  it("detects a changed pixel at the threshold boundary", () => {
    const baseline: LinearImage = { width: 2, height: 1, rgb: new Float32Array([0, 0, 0, 0, 0, 0]) };
    const actual: LinearImage = { width: 2, height: 1, rgb: new Float32Array([0, 0, 0, 0.3, 0.3, 0.3]) };
    const result = compareImages(baseline, actual, 0.05);
    expect(result.metrics.changedPixelFraction).toBe(0.5);
    expect(result.metrics.p95AbsoluteError).toBeCloseTo(0.3, 6);
  });
});

describe("absolute timing and counter gates", () => {
  const checkpoint: WebQaCheckpoint = {
    name: "main",
    p95_frame_ms: 12,
    areas: { flags: { readback: 1 }, counters: { overflow: 0 } },
  };

  it("fails missing required metrics and required threshold violations", () => {
    const results = evaluateTimingGates(checkpoint, [
      { id: "frame", metric: "frame_ms_p95", max: 11.1, enforcement: "required", required: true },
      { id: "missing", metric: "areas.gpu.missing", max: 1, enforcement: "required", required: true },
    ]);
    expect(results.map((result) => result.status)).toEqual(["FAIL", "FAIL"]);
  });

  it("reports optional counters as not applicable and overflows as failures", () => {
    const results = evaluateCounterGates(checkpoint, [
      { id: "optional", key: "areas.optional.value", operator: "equals", value: 0, required: false },
      { id: "readback", key: "areas.flags.readback", operator: "equals", value: 0, required: true },
    ]);
    expect(results.map((result) => result.status)).toEqual(["NOT_APPLICABLE", "FAIL"]);
  });
});

describe("deterministic readiness", () => {
  it("blocks freeze while streaming work remains", () => {
    const blockers = readinessBlockers({
      ready: true, error: null, progressMsg: "ready",
      stats: { fps: 60, frameMs: 16, frameMsP95: 16, drawCalls: 1, triangles: 1, frame: 1, counters: { far_summary_tiles_building: 1 }, gpuPasses: {} },
    } as unknown as import("../../core/hooks.js").ClodHooks);
    expect(blockers).toContain("far_summary_tiles_building=1");
  });
});
