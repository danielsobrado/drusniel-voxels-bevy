import { describe, expect, it } from "vitest";
import type { Phase0Config } from "../../../phase0/phase0_config.js";
import { resolveLiveClodRootRadius } from "./live_clod_root_radius.js";

function phase0Config(clodRadiusM: number, clodRefinementRadiusM?: number): Phase0Config {
  return {
    phase0: {
      target_visible_m: 256,
      target_future_visible_m: 2048,
      streaming: {
        preload_seconds: 4,
        live_radius_m: 128,
        clod_radius_m: clodRadiusM,
        ...(clodRefinementRadiusM === undefined ? {} : { clod_refinement_radius_m: clodRefinementRadiusM }),
      },
      scenes: {},
    },
    metrics: { required_counters: ["stream_ready_frame"] },
    acceptance: {
      allow_current_4km_failure: false,
      visible_target_required_for_future_phases: true,
      max_horizon_hole_ratio: 0,
      max_streamer_simulated_missing_chunks: 0,
      max_streamer_simulated_missing_pages: 0,
    },
  };
}

describe("resolveLiveClodRootRadius", () => {
  it("uses the deterministic refinement radius when config has no explicit stream radius", () => {
    expect(resolveLiveClodRootRadius(new URLSearchParams(), phase0Config(2048), 96)).toBe(768);
  });

  it("uses the configured CLOD refinement radius when present", () => {
    expect(resolveLiveClodRootRadius(new URLSearchParams(), phase0Config(2048, 640), 96)).toBe(640);
  });

  it("lets an explicit URL stream radius override the phase0 CLOD refinement radius", () => {
    expect(resolveLiveClodRootRadius(new URLSearchParams("liveClodRootRadius=512"), phase0Config(2048, 640), 96)).toBe(512);
  });
});
