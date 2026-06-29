import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import treesYaml from "../../config/trees.yaml?raw";
import { TREE_EXPANDED_SPECIES, TREE_EXPANDED_SPECIES_DEFAULTS, TREE_EXPANDED_SPECIES_NICHES } from "./index.js";

type RawTreesConfig = {
  trees?: {
    ecology?: {
      material_bias?: Record<string, Record<string, number>>;
      species_zones?: Record<string, unknown>;
    };
    species?: Record<string, unknown>;
  };
};

describe("TREE-9 six-species YAML contract", () => {
  it("keeps all expanded species represented in config/trees.yaml", () => {
    const raw = load(treesYaml) as RawTreesConfig;
    const species = raw.trees?.species ?? {};
    const zones = raw.trees?.ecology?.species_zones ?? {};
    const materialBias = raw.trees?.ecology?.material_bias ?? {};

    for (const id of TREE_EXPANDED_SPECIES) {
      expect(species[id], `${id} species config`).toBeDefined();
      expect(zones[id], `${id} species zone`).toBeDefined();
      for (const material of ["grass", "rock", "sand", "snow"] as const) {
        expect(materialBias[material]?.[id], `${material}.${id} material bias`).toBeTypeOf("number");
      }
    }
  });

  it("keeps YAML species weights aligned with TREE-9 defaults", () => {
    const raw = load(treesYaml) as RawTreesConfig;
    const species = raw.trees?.species as Record<string, { weight?: number }>;

    for (const id of TREE_EXPANDED_SPECIES) {
      expect(species[id]?.weight).toBeCloseTo(TREE_EXPANDED_SPECIES_DEFAULTS[id].weight, 6);
    }
  });

  it("keeps YAML ecological niches aligned with TREE-9 defaults", () => {
    const raw = load(treesYaml) as RawTreesConfig;
    const zones = raw.trees?.ecology?.species_zones as Record<string, {
      moisture_preference?: number;
      slope_tolerance?: number;
      cluster_bias?: number;
    }>;

    for (const id of TREE_EXPANDED_SPECIES) {
      const niche = TREE_EXPANDED_SPECIES_NICHES[id];
      expect(zones[id]?.moisture_preference).toBeCloseTo(niche.moisturePreference, 6);
      expect(zones[id]?.slope_tolerance).toBeCloseTo(niche.slopeTolerance, 6);
      expect(zones[id]?.cluster_bias).toBeCloseTo(niche.clusterBias, 6);
    }
  });
});
