import { describe, expect, it } from "vitest";
import { wireTreeConfigTree9Source } from "./wire-tree-config-tree9-species.mjs";

const FIXTURE = `
import { load } from "js-yaml";

export type TreeSpeciesId = "oak" | "pine" | "dead";
export const TREE_SPECIES: readonly TreeSpeciesId[] = ["oak", "pine", "dead"] as const;

export const DEFAULT_TREE_ECOLOGY_SETTINGS: TreeEcologySettings = {
  enabled: true,
  speciesZones: {
    oak: { heightPreference: "low", moisturePreference: 0.65, slopeTolerance: 0.55, clusterBias: 0.75, oldForestBias: 0 },
    pine: { heightPreference: "high", moisturePreference: 0.35, slopeTolerance: 0.85, clusterBias: 0.9, oldForestBias: 0 },
    dead: { heightPreference: "any", moisturePreference: 0.45, slopeTolerance: 0.75, clusterBias: 1.0, oldForestBias: 0.85 },
  },
};

export const DEFAULT_TREE_SETTINGS: TreeSettings = {
  species: {
    oak: {
      enabled: true,
      weight: 0.52,
      morphology: {},
    },
  },
  render: { debugColorByLod: false },
};

export function cloneTreeSettings(settings: TreeSettings = DEFAULT_TREE_SETTINGS): TreeSettings {
  return {
    species: {
      oak: cloneSpecies(settings.species.oak),
      pine: cloneSpecies(settings.species.pine),
      dead: cloneSpecies(settings.species.dead),
    },
  };
}

export function parseTreeConfig(): TreeSettings {
  return {
    species: {
      oak: readSpecies(fallback.species.oak, raw.species?.oak),
      pine: readSpecies(fallback.species.pine, raw.species?.pine),
      dead: readSpecies(fallback.species.dead, raw.species?.dead),
    },
  };
}

function cloneSpecies(species: TreeSpeciesSettings): TreeSpeciesSettings {
  return { ...species, morphology: { ...species.morphology } };
}

function cloneTreeEcology(ecology: TreeEcologySettings): TreeEcologySettings {
  return {
    speciesZones: {
      oak: { ...ecology.speciesZones.oak },
      pine: { ...ecology.speciesZones.pine },
      dead: { ...ecology.speciesZones.dead },
    },
  };
}

function readTreeEcologySettings(): TreeEcologySettings {
  return {
    speciesZones: {
      oak: readSpeciesZone(fallback.speciesZones.oak, raw?.species_zones?.oak),
      pine: readSpeciesZone(fallback.speciesZones.pine, raw?.species_zones?.pine),
      dead: readSpeciesZone(fallback.speciesZones.dead, raw?.species_zones?.dead),
    },
  };
}
`;

const EDIT_COUNT = 10;

describe("TREE-9 tree config species wiring script", () => {
  it("rewrites the hardcoded three-species config path", () => {
    const result = wireTreeConfigTree9Source(FIXTURE);

    expect(result.changed).toBe(true);
    expect(result.applied).toHaveLength(EDIT_COUNT);
    expect(result.source).toContain("TREE_EXPANDED_SPECIES_DEFAULTS");
    expect(result.source).toContain("export type TreeSpeciesId = TreeExpandedSpeciesId");
    expect(result.source).toContain("export const TREE_SPECIES: readonly TreeSpeciesId[] = TREE_EXPANDED_SPECIES");
    expect(result.source).toContain("speciesZones: speciesZonesFromExpandedDefaults()");
    expect(result.source).toContain("species: cloneSpeciesSettingsMap(TREE_EXPANDED_SPECIES_DEFAULTS)");
    expect(result.source).toContain("species: readSpeciesSettingsMap(fallback.species, raw.species)");
    expect(result.source).toContain("function readSpeciesZoneMap");
  });

  it("preserves CRLF output", () => {
    const result = wireTreeConfigTree9Source(FIXTURE.replace(/\n/g, "\r\n"));

    expect(result.changed).toBe(true);
    expect(result.applied).toHaveLength(EDIT_COUNT);
    expect(result.source).toContain("\r\n");
  });

  it("is idempotent", () => {
    const first = wireTreeConfigTree9Source(FIXTURE);
    const second = wireTreeConfigTree9Source(first.source);

    expect(second.changed).toBe(false);
    expect(second.applied).toHaveLength(0);
    expect(second.skipped).toHaveLength(EDIT_COUNT);
  });
});
