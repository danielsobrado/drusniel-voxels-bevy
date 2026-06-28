import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROCEDURAL_TEXTURE_CONFIG,
  MAX_ACTIVE_BIOME_TEXTURES,
  PROCEDURAL_TEXTURE_LAYER_BUDGET,
  TERRAIN_COMMON_PROCEDURAL_MATERIAL_IDS,
  estimateTerrainTextureArrayBytes,
  parseProceduralTextureConfig,
  resolveActiveBiomeMaterials,
  resolveActiveProceduralMaterialOrder,
  withActiveBiomeProceduralMaterials,
} from "./materialRecipes.js";
import {
  TEXTURE_DOMAIN_BUDGETS,
  getTextureDomainBudget,
  totalResidentTextureSetBudget,
} from "./texture_domain_policy.js";

describe("texture domain streaming policy", () => {
  it("caps terrain authored biome layers to two active materials", () => {
    const active = resolveActiveBiomeMaterials([
      "forest-floor",
      "swamp-muck",
      "mountain-scree",
      "forest-floor",
    ]);

    expect(active).toEqual(["forest-floor", "swamp-muck"]);
    expect(active.length).toBe(MAX_ACTIVE_BIOME_TEXTURES);
  });

  it("builds terrain order as common layers plus the two-biome window", () => {
    const order = resolveActiveProceduralMaterialOrder(["coast-sand", "ocean-floor", "plains-grass"]);

    expect(order.slice(0, TERRAIN_COMMON_PROCEDURAL_MATERIAL_IDS.length)).toEqual([...TERRAIN_COMMON_PROCEDURAL_MATERIAL_IDS]);
    expect(order.slice(TERRAIN_COMMON_PROCEDURAL_MATERIAL_IDS.length)).toEqual(["coast-sand", "ocean-floor"]);
    expect(order.length).toBe(PROCEDURAL_TEXTURE_LAYER_BUDGET.maxResidentTerrainLayers);
  });

  it("parses active biome config but never all authored biome recipes as resident layers", () => {
    const config = parseProceduralTextureConfig(`
procedural_textures:
  terrain:
    active_biome_materials: [forest-floor, swamp-muck, mountain-scree, coast-sand]
    material_order: [grass, rock, sand, snow, dirt, moss, gravel, wet_soil]
`);

    expect(config.terrain.active_biome_materials).toEqual(["forest-floor", "swamp-muck"]);
    expect(config.terrain.material_order).toEqual([
      ...TERRAIN_COMMON_PROCEDURAL_MATERIAL_IDS,
      "forest-floor",
      "swamp-muck",
    ]);
    expect(config.terrain.material_order.length).toBe(PROCEDURAL_TEXTURE_LAYER_BUDGET.maxResidentTerrainLayers);
  });

  it("keeps common-only procedural material overrides intact", () => {
    const config = parseProceduralTextureConfig(`
procedural_textures:
  terrain:
    material_order: [rock, grass]
`);

    expect(config.terrain.material_order).toEqual(["rock", "grass"]);
  });

  it("can rebuild a config for a new current plus adjacent biome window", () => {
    const next = withActiveBiomeProceduralMaterials(DEFAULT_PROCEDURAL_TEXTURE_CONFIG, ["plains-grass", "coast-sand"]);

    expect(next.terrain.active_biome_materials).toEqual(["plains-grass", "coast-sand"]);
    expect(next.terrain.material_order.slice(-2)).toEqual(["plains-grass", "coast-sand"]);
  });

  it("keeps the resident terrain texture memory estimate tied to common plus two biome layers", () => {
    const bytes = estimateTerrainTextureArrayBytes(
      PROCEDURAL_TEXTURE_LAYER_BUDGET.maxResidentTerrainLayers,
      PROCEDURAL_TEXTURE_LAYER_BUDGET.defaultLayerResolution,
    );

    expect(bytes).toBeGreaterThan(0);
    expect(PROCEDURAL_TEXTURE_LAYER_BUDGET.maxResidentTerrainLayers).toBe(10);
  });

  it("keeps terrain, construction, character, decal, and UI budgets separate", () => {
    expect(getTextureDomainBudget("terrain-biome-window").maxResidentSets).toBe(2);
    expect(getTextureDomainBudget("construction").eviction).toBe("lru-use");
    expect(getTextureDomainBudget("character").eviction).toBe("lru-distance");
    expect(TEXTURE_DOMAIN_BUDGETS.ui.maxResidentSets).toBeGreaterThan(0);
    expect(totalResidentTextureSetBudget()).toBeGreaterThan(2);
  });
});
