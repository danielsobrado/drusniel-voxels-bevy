import { describe, expect, it } from "vitest";
import { DEFAULT_SHADOW_PROXY_CONFIG } from "../config/longViewDefaults.js";
import {
  clampProxyHeight,
  ringFadeWeight,
  validateShadowProxyConfig,
  validateTerrainSummarySource,
} from "./shadowProxyValidation.js";
import { buildTerrainSummary } from "../clod/terrain_summary.js";

describe("shadow proxy validation", () => {
  it("flags invalid config", () => {
    expect(validateShadowProxyConfig({ ...DEFAULT_SHADOW_PROXY_CONFIG, gridRes: 0 }).ok).toBe(false);
    expect(validateShadowProxyConfig({ ...DEFAULT_SHADOW_PROXY_CONFIG, endM: -1 }).ok).toBe(false);
  });

  it("flags missing summary", () => {
    expect(validateTerrainSummarySource(undefined).ok).toBe(false);
  });

  it("accepts built summary", () => {
    const summary = buildTerrainSummary([], 64, 4);
    expect(validateTerrainSummarySource(summary).ok).toBe(true);
  });

  it("clamps proxy heights and fades ring weights", () => {
    expect(clampProxyHeight(Number.NaN, DEFAULT_SHADOW_PROXY_CONFIG)).toBe(DEFAULT_SHADOW_PROXY_CONFIG.minHeightM);
    expect(ringFadeWeight(0, DEFAULT_SHADOW_PROXY_CONFIG)).toBeGreaterThanOrEqual(0);
    expect(ringFadeWeight(DEFAULT_SHADOW_PROXY_CONFIG.startM, DEFAULT_SHADOW_PROXY_CONFIG)).toBe(1);
  });
});
