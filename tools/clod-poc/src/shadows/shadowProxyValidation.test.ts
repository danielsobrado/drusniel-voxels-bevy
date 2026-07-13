import { afterEach, describe, expect, it } from "vitest";
import { buildTerrainSummary, sampleHeight, sampleSkirtHeight, summaryBaseLevel } from "../clod/terrain_summary.js";
import { DEFAULT_SHADOW_PROXY_CONFIG } from "../config/longViewDefaults.js";
import { surfaceHeightCore } from "../gpu/terrain_field_core.js";
import {
  clampProxyHeight,
  ringFadeWeight,
  sampleProxyHeight,
  validateShadowProxyConfig,
  validateTerrainSummarySource,
} from "./shadowProxyValidation.js";

describe("shadow proxy validation", () => {
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
  });
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

  it("samples analytic far terrain outside the summary footprint (not edge-clamped)", () => {
    const summary = buildTerrainSummary([], 512, 8);
    summary.heightMax.fill(420);
    const config = { ...DEFAULT_SHADOW_PROXY_CONFIG, startM: 0, endM: 4096, edgeFadeM: 0 };
    const farBase = summaryBaseLevel(summary);
    const dist = 3000;
    const x = -1000;

    const analytic = surfaceHeightCore(x, 256);
    const edgeClamped = sampleHeight(summary, x, 256);
    const skirt = sampleSkirtHeight(summary, x, 256, config.endM, farBase, 1.0);
    const proxy = sampleProxyHeight(summary, x, 256, config, dist);

    expect(edgeClamped).toBeCloseTo(analytic, 4);
    expect(edgeClamped).not.toBeCloseTo(420, 0);
    expect(skirt).not.toBeCloseTo(edgeClamped, 1);
    expect(proxy).not.toBeCloseTo(edgeClamped, 1);
    expect(proxy).toBeCloseTo(
      farBase + (clampProxyHeight(skirt + config.heightBiasM, config) - farBase) * ringFadeWeight(dist, config),
      4,
    );
  });

  it("adds unified-summary occluder height to the shadow proxy", () => {
    const summary = buildTerrainSummary([], 512, 8);
    const config = { ...DEFAULT_SHADOW_PROXY_CONFIG, startM: 0, endM: 4096, edgeFadeM: 0 };
    (globalThis as unknown as { window?: unknown }).window = {
      __drusnielFarSummary: {
        getHeightProvider: () => ({
          sampleHeight: () => 40,
          sampleNormal: () => ({ x: 0, y: 1, z: 0 }),
          sampleSummaryInto: (_x: number, _z: number, _distance: number, out: Record<string, number>) => {
            Object.assign(out, { height: 40, occluderHeight: 12 });
            return true;
          },
        }),
      },
    };

    expect(sampleProxyHeight(summary, 100, 100, config, 1000)).toBeCloseTo(52 + config.heightBiasM);
  });
});
