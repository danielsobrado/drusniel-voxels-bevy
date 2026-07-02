import { describe, expect, it } from "vitest";
import { parseTerrainMaterialCacheConfig } from "./terrainMaterialCacheConfig.js";

describe("terrain material cache config", () => {
  it("loads defaults from yaml", () => {
    const cfg = parseTerrainMaterialCacheConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.bake.maxTilesBakedPerFrame).toBe(2);
    expect(cfg.formats.farColor).toBe("rgba8");
    expect(cfg.sampling.pageResolution).toBe(64);
    expect(cfg.quality.fallbackMode).toBe("existing_shader_path");
  });

  it("clamps invalid numeric values and rejects unknown formats", () => {
    const cfg = parseTerrainMaterialCacheConfig(`
terrain_material_cache:
  budget:
    max_bytes: -5
  bake:
    max_tiles_baked_per_frame: -2
  formats:
    far_color: rgba32f
  debug:
    show_format_channels: far_color
`);
    expect(cfg.budget.maxBytes).toBe(1);
    expect(cfg.bake.maxTilesBakedPerFrame).toBe(0);
    expect(cfg.formats.farColor).toBe("rgba8");
    expect(cfg.debug.showFormatChannels).toBe("far_color");
  });
});
