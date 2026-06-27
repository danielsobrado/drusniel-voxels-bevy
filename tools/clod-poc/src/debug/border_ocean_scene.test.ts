import { describe, expect, it } from "vitest";
import {
  probeCliffDryAboveSea,
  probePlayableOceanOutside,
  validateBorderOceanStats,
} from "./border_ocean_scene.js";
import { DEFAULT_BORDER_COAST_OCEAN_CONFIG } from "../terrain/border_coast_config.js";
import { createDeepOceanSampler } from "../water/ocean_service.js";

describe("border-ocean acceptance probes", () => {
  it("validates playable ocean outside the square", () => {
    const sampler = createDeepOceanSampler(1024, {
      ...DEFAULT_BORDER_COAST_OCEAN_CONFIG.deepOcean,
      extendCells: 384,
      surfaceY: 18,
      segments: 64,
    });
    expect(probePlayableOceanOutside(sampler, 1024)).toBe(1);
  });

  it("validates synthetic stats payload", () => {
    validateBorderOceanStats({
      ready: true,
      error: null,
      counters: {
        "border_ocean.scene": 1,
        "border_ocean.coast_runtime_active": 1,
        "border_ocean.deep_ocean_enabled": 1,
        "border_ocean.deep_ocean_mesh_present": 1,
        "border_ocean.deep_ocean_vertices": 5000,
        "border_ocean.page_source_purity": 1,
        "border_ocean.interior_water_wet_ratio": 0.05,
        "border_ocean.playable_ocean_outside_ok": 1,
        "border_ocean.cliff_dry_above_sea": probeCliffDryAboveSea(18, 256),
      },
    });
  });
});
