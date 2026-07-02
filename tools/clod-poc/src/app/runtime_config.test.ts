import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLOD_RUNTIME_CONFIG,
  parseClodRuntimeConfig,
  resolveSlowFrameMsThreshold,
} from "./runtime_config.js";


describe("parseClodRuntimeConfig", () => {
  it("parses bundled clod_runtime.yaml defaults", () => {
    const config = parseClodRuntimeConfig();
    expect(config.runtime.worldOptions).toEqual([2, 4, 8, 16, 32]);
    expect(config.webgpuSelection.errorMaxAgeFrames).toBe(6);
    expect(config.webgpuSelection.dispatchIntervalFrames).toBe(2);
    expect(config.webgpuSelection.parityIntervalFrames).toBe(60);
    expect(config.webgpuSelection.errorTolerancePx).toBe(0.02);
    expect(config.terrainTextures.textureArraySize).toBe(512);
    expect(config.nearField.chunkGroupBuildBudget).toBe(1);
    expect(config.nearField.maxCachedChunkGroups).toBe(64);
    expect(config.nearField.evictDistanceMultiplier).toBe(2.5);
    expect(config.renderNodeCache.maxInactiveNodes).toBe(512);
    expect(config.renderNodeCache.pruneIntervalFrames).toBe(30);
    expect(config.renderNodeCache.maxPrefetchCreatesPerFrame).toBe(8);
    expect(config.renderNodeCache.evictGeometryWithRenderNode).toBe(true);
    expect(config.selectionCutCache.enabled).toBe(true);
    expect(config.selectionCutCache.cameraCellSizeM).toBe(1);
    expect(config.selectionCutCache.cameraHeightCellSizeM).toBe(2);
    expect(config.selectionCutCache.thresholdBucketPx).toBe(0.05);
    expect(config.selectionCutCache.maxReuseFrames).toBe(8);
    expect(config.materialChurn.enabled).toBe(true);
    expect(config.materialChurn.collectMaterialVersions).toBe(true);
    expect(config.materialChurn.collectRendererPrograms).toBe(true);
    expect(config.materialChurn.logSpikeWarnings).toBe(false);
    expect(config.materialChurn.spikeWarnThresholdPerFrame).toBe(32);
    expect(config.materialChurn.maxTrackedMaterials).toBe(4096);
    expect(config.renderResolution.dprCap).toBe(1.5);
    expect(config.renderResolution.renderScale).toBe(1.0);
    expect(config.renderResolution.minEffectivePixelRatio).toBe(0.5);
    expect(config.renderResolution.maxEffectivePixelRatio).toBe(2.0);
    expect(config.renderResolution.presets.performance100).toEqual({ dprCap: 1.0, renderScale: 0.85 });
    expect(config.renderResolution.presets.high).toEqual({ dprCap: 1.5, renderScale: 1.0 });
    expect(config.digging.holdIntervalMs).toBe(400);
    expect(config.profiling.slowFrameMs).toBe(24);
  });

  it("falls back to defaults on invalid yaml", () => {
    const brokenYaml = "not: [valid";
    expect(parseClodRuntimeConfig(brokenYaml)).toEqual(DEFAULT_CLOD_RUNTIME_CONFIG);
  });
});

describe("resolveSlowFrameMsThreshold", () => {
  it("uses profileMs query param when positive", () => {
    const params = new URLSearchParams("profileMs=16");
    expect(resolveSlowFrameMsThreshold(params, 24)).toBe(16);
  });

  it("falls back to configured default", () => {
    const params = new URLSearchParams();
    expect(resolveSlowFrameMsThreshold(params, 24)).toBe(24);
  });
});
