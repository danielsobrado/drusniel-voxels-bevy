import { describe, expect, it } from "vitest";
import {
  farSummaryGpuConfigFromParams,
  farSummaryGpuDefaultsForScene,
} from "./gpu-config.js";

describe("far-summary GPU defaults", () => {
  it("makes unified infinite-islands GPU-authoritative by default", () => {
    const params = new URLSearchParams("scene=infinite-islands&farSummaryLayout=2");
    expect(farSummaryGpuDefaultsForScene(params)).toMatchObject({
      enabled: true,
      debugReadback: true,
      commitToCache: true,
      authoritative: true,
      maxTilesPerBatch: 8,
    });
  });

  it("retains explicit CPU fallback kill switches", () => {
    const params = new URLSearchParams(
      "scene=infinite-islands&farSummaryLayout=2&farSummaryGpu=0&farSummaryGpuAuthoritative=0&farSummaryGpuCommit=0&farSummaryGpuDebugReadback=0",
    );
    const defaults = farSummaryGpuDefaultsForScene(params);
    expect(farSummaryGpuConfigFromParams(params, defaults)).toMatchObject({
      enabled: false,
      debugReadback: false,
      commitToCache: false,
      authoritative: false,
    });
  });
});
