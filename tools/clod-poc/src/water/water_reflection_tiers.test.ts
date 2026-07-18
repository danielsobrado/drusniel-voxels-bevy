import type * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_WATER_CONFIG, DEFAULT_WATER_VISUAL } from "./water_config_defaults.js";
import { cloneWaterConfig } from "./water_config_clone.js";
import { parseWaterConfig } from "./water_config_parsing.js";
import { WATER_DEBUG_MODES, type WaterVisualConfig } from "./waterConfig.js";
import type { WaterMaterialHandle, WaterMaterialParams } from "./waterMaterial.js";
import { applyWaterQueryOverrides } from "./water_quality_overrides.js";
import {
  createTieredWaterMaterialFactory,
  waterMaterialLevelCellSize,
} from "./water_reflection_tier_clipmap.js";
import { resolveWaterReflectionTierVisual } from "./water_reflection_tiers.js";

function activeVisual(): WaterVisualConfig {
  return {
    ...DEFAULT_WATER_VISUAL,
    reflection: {
      ...DEFAULT_WATER_VISUAL.reflection,
      mode: "ssr",
      ssrEnabled: true,
      maxSteps: 18,
      clipmapTiers: {
        enabled: true,
        fullQualityMaxCellSizeM: 4,
        midQualityMaxCellSizeM: 16,
        midMaxSteps: 6,
      },
    },
  };
}

function materialParams(visual: WaterVisualConfig, cellSize: number): WaterMaterialParams {
  return {
    visual,
    debugMode: WATER_DEBUG_MODES.final,
    sunDirection: {} as THREE.Vector3,
    cameraPosition: {} as THREE.Vector3,
    worldBounds: { cellsX: 0, cellsZ: 0 },
    staticGrid: {
      texelsA: null as unknown as THREE.DataTexture,
      texelsB: null as unknown as THREE.DataTexture,
      texelsC: null as unknown as THREE.DataTexture,
      vertsPerEdge: 97,
      cellSize,
    },
  };
}

function materialHandle(updateVisual = vi.fn()): WaterMaterialHandle {
  return {
    material: {} as THREE.Material,
    setTime: vi.fn(),
    setDebugMode: vi.fn(),
    setInnerRect: vi.fn(),
    setLevelId: vi.fn(),
    setClipmapTint: vi.fn(),
    setWireframe: vi.fn(),
    updateCamera: vi.fn(),
    updateSunDirection: vi.fn(),
    updateVisual,
    dispose: vi.fn(),
  };
}

describe("water reflection clipmap tiers", () => {
  it("preserves exact visual identity while disabled or unavailable", () => {
    const disabled = activeVisual();
    disabled.reflection.clipmapTiers.enabled = false;
    expect(resolveWaterReflectionTierVisual(disabled, 32)).toBe(disabled);

    const active = activeVisual();
    expect(resolveWaterReflectionTierVisual(active, null)).toBe(active);
    expect(resolveWaterReflectionTierVisual(active, Number.NaN)).toBe(active);
    expect(resolveWaterReflectionTierVisual(active, 0)).toBe(active);
  });

  it("keeps full SSR on fine rings", () => {
    const visual = activeVisual();

    expect(resolveWaterReflectionTierVisual(visual, 4)).toBe(visual);
  });

  it("uses bounded reduced-step SSR on mid rings", () => {
    const visual = activeVisual();
    const resolved = resolveWaterReflectionTierVisual(visual, 8);

    expect(resolved).not.toBe(visual);
    expect(resolved.bodies).toBe(visual.bodies);
    expect(resolved.reflection.ssrEnabled).toBe(true);
    expect(resolved.reflection.maxSteps).toBe(6);
    expect(visual.reflection.maxSteps).toBe(18);
  });

  it("uses the existing fallback path on coarse rings", () => {
    const visual = activeVisual();
    const resolved = resolveWaterReflectionTierVisual(visual, 32);

    expect(resolved.reflection.ssrEnabled).toBe(false);
    expect(resolved.reflection.maxSteps).toBe(0);
    expect(resolved.reflection.skyFallbackStrength).toBe(visual.reflection.skyFallbackStrength);
    expect(resolved.reflection.terrainFallbackStrength).toBe(visual.reflection.terrainFallbackStrength);
  });

  it("never increases the configured SSR step count", () => {
    const visual = activeVisual();
    visual.reflection.maxSteps = 4;
    visual.reflection.clipmapTiers.midMaxSteps = 20;

    expect(resolveWaterReflectionTierVisual(visual, 8)).toBe(visual);
  });

  it("wraps initial and later material visuals using the level cell size", () => {
    const initialVisual = activeVisual();
    const updateVisual = vi.fn();
    const handle = materialHandle(updateVisual);
    const createMaterial = vi.fn((params: WaterMaterialParams) => {
      expect(params.visual.reflection.maxSteps).toBe(6);
      return handle;
    });
    const tieredFactory = createTieredWaterMaterialFactory(createMaterial);

    const returned = tieredFactory(materialParams(initialVisual, 8));
    expect(createMaterial).toHaveBeenCalledOnce();
    expect(waterMaterialLevelCellSize(materialParams(initialVisual, 8))).toBe(8);

    returned.updateVisual(initialVisual);
    expect(updateVisual).toHaveBeenCalledOnce();
    expect(updateVisual.mock.calls[0]?.[0].reflection.maxSteps).toBe(6);
  });

  it("parses and deep-clones YAML-owned tier settings", () => {
    const parsed = parseWaterConfig([
      "water:",
      "  visual:",
      "    reflection:",
      "      clipmap_tiers:",
      "        enabled: true",
      "        full_quality_max_cell_size_m: 3",
      "        mid_quality_max_cell_size_m: 12",
      "        mid_max_steps: 5",
    ].join("\n"), () => {});

    expect(parsed.visual.reflection.clipmapTiers).toEqual({
      enabled: true,
      fullQualityMaxCellSizeM: 3,
      midQualityMaxCellSizeM: 12,
      midMaxSteps: 5,
    });

    const cloned = cloneWaterConfig(parsed);
    expect(cloned.visual.reflection.clipmapTiers).not.toBe(parsed.visual.reflection.clipmapTiers);
    cloned.visual.reflection.clipmapTiers.midMaxSteps = 2;
    expect(parsed.visual.reflection.clipmapTiers.midMaxSteps).toBe(5);
  });

  it("supports explicit query enable and disable aliases", () => {
    const enabled = applyWaterQueryOverrides(
      DEFAULT_WATER_CONFIG,
      new URLSearchParams({ waterReflectionTiers: "1" }),
    );
    expect(enabled.visual.reflection.clipmapTiers.enabled).toBe(true);

    const configured = cloneWaterConfig(DEFAULT_WATER_CONFIG);
    configured.visual.reflection.clipmapTiers.enabled = true;
    const disabled = applyWaterQueryOverrides(
      configured,
      new URLSearchParams({ waterReflectionFallback: "0" }),
    );
    expect(disabled.visual.reflection.clipmapTiers.enabled).toBe(false);
  });
});
