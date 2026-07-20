import { describe, expect, it } from "vitest";
import configText from "../../../config/probe_gi.yaml?raw";
import { parseProbeGiConfig } from "./config.js";
import { createProbeGiRuntime } from "./runtime.js";
import { PROBE_GI_TOTAL_PROBES } from "./constants.js";

const providers = {
  terrain: {
    heightAt: (x: number, z: number) => x * 0.01 + z * 0.02,
    revision: () => 7,
  },
  solid: {
    densityAt: () => -1,
  },
} as const;

function enabledConfig() {
  return { ...parseProbeGiConfig(configText), enabled: true };
}

const drainOptions = {
  clock: () => 0,
  positioningBudgetMs: Number.POSITIVE_INFINITY,
  maximumColumnsPerFrame: Number.POSITIVE_INFINITY,
} as const;

describe("probe GI PGI-1/2 runtime", () => {
  it("starts empty, incrementally positions all layers, and publishes N-1 textures", () => {
    const runtime = createProbeGiRuntime(enabledConfig(), providers, 0, 0, drainOptions);
    try {
      expect(runtime.diagnostics.probe_gi_valid_probes).toBe(0);
      expect(runtime.diagnostics.probe_gi_new_slab_queue).toBe(3072);
      expect(runtime.update(0, 0, 0)).toBe(true);
      expect(runtime.diagnostics.probe_gi_total_probes).toBe(PROBE_GI_TOTAL_PROBES);
      expect(runtime.diagnostics.probe_gi_valid_probes).toBe(PROBE_GI_TOTAL_PROBES);
      expect(runtime.diagnostics.probe_gi_new_slab_queue).toBe(0);
      expect(runtime.publishFrameBoundary(0)).toBe(false);
      expect(runtime.publishFrameBoundary(1)).toBe(true);
      expect(runtime.publication.read("near").generation).toBe(1);
    } finally {
      runtime.dispose();
    }
  });

  it("caps positioning work and avoids a synchronous full startup build", () => {
    const runtime = createProbeGiRuntime(enabledConfig(), providers, 0, 0, {
      clock: () => 0,
      positioningBudgetMs: Number.POSITIVE_INFINITY,
      maximumColumnsPerFrame: 1,
    });
    try {
      runtime.update(0, 0, 0);
      expect(runtime.diagnostics.probe_gi_positioned_this_frame).toBe(1);
      expect(runtime.diagnostics.probe_gi_valid_probes).toBe(8);
      expect(runtime.diagnostics.probe_gi_new_slab_queue).toBe(3071);
    } finally {
      runtime.dispose();
    }
  });

  it("does not remap below one cell and schedules one near slab after crossing it", () => {
    const config = enabledConfig();
    const runtime = createProbeGiRuntime(config, providers, 0, 0, drainOptions);
    try {
      runtime.update(0, 0, 0);
      const initialOrigin = runtime.cascades[0].origin;
      runtime.update(3.99, 0, 2);
      expect(runtime.cascades[0].origin).toEqual(initialOrigin);
      runtime.update(4.01, 0, 3);
      expect(runtime.diagnostics.probe_gi_near_recentered_columns).toBe(32);
      expect(runtime.diagnostics.probe_gi_mid_recentered_columns).toBe(0);
      expect(runtime.diagnostics.probe_gi_far_recentered_columns).toBe(0);
    } finally {
      runtime.dispose();
    }
  });
});
