import { describe, expect, it } from "vitest";
import {
  cloneTreeSettings,
  DEFAULT_TREE_ECOLOGY_SETTINGS,
  DEFAULT_TREE_FOLIAGE_SETTINGS,
  DEFAULT_TREE_SETTINGS,
  DEFAULT_TREE_WIND_SETTINGS,
  parseTreeConfig,
} from "./index.js";
import treeYamlText from "../../config/trees.yaml?raw";

describe("tree placement", () => {
  it("keeps default tree wind settings independent from the shared wind defaults", () => {
    expect(DEFAULT_TREE_SETTINGS.wind).not.toBe(DEFAULT_TREE_WIND_SETTINGS);
    expect(DEFAULT_TREE_SETTINGS.wind.direction).not.toBe(DEFAULT_TREE_WIND_SETTINGS.direction);
    expect(DEFAULT_TREE_SETTINGS.wind).toEqual(DEFAULT_TREE_WIND_SETTINGS);
  });

  it("deep-clones tree wind direction", () => {
    const cloned = cloneTreeSettings();
    expect(cloned.wind).not.toBe(DEFAULT_TREE_SETTINGS.wind);
    expect(cloned.wind.direction).not.toBe(DEFAULT_TREE_SETTINGS.wind.direction);
    cloned.wind.direction[0] = -1;
    expect(DEFAULT_TREE_SETTINGS.wind.direction[0]).toBe(DEFAULT_TREE_WIND_SETTINGS.direction[0]);
  });

  it("deep-clones tree ecology settings", () => {
    const cloned = cloneTreeSettings();
    expect(cloned.ecology).not.toBe(DEFAULT_TREE_SETTINGS.ecology);
    expect(cloned.ecology.density).not.toBe(DEFAULT_TREE_SETTINGS.ecology.density);
    expect(cloned.ecology.speciesZones.oak).not.toBe(DEFAULT_TREE_SETTINGS.ecology.speciesZones.oak);
    cloned.ecology.density.baseDensity = 0.25;
    cloned.ecology.speciesZones.oak.moisturePreference = 0.1;
    expect(DEFAULT_TREE_SETTINGS.ecology.density.baseDensity).toBe(DEFAULT_TREE_ECOLOGY_SETTINGS.density.baseDensity);
    expect(DEFAULT_TREE_SETTINGS.ecology.speciesZones.oak.moisturePreference)
      .toBe(DEFAULT_TREE_ECOLOGY_SETTINGS.speciesZones.oak.moisturePreference);
  });

  it("deep-clones tree foliage settings", () => {
    const cloned = cloneTreeSettings();
    expect(cloned.foliage).not.toBe(DEFAULT_TREE_SETTINGS.foliage);
    expect(cloned.foliage.oak).not.toBe(DEFAULT_TREE_SETTINGS.foliage.oak);
    expect(cloned.foliage.pine).not.toBe(DEFAULT_TREE_SETTINGS.foliage.pine);
    cloned.foliage.oak.cardCountNear = 1;
    cloned.foliage.pine.edgeNoise = 0;
    expect(DEFAULT_TREE_SETTINGS.foliage.oak.cardCountNear).toBe(DEFAULT_TREE_FOLIAGE_SETTINGS.oak.cardCountNear);
    expect(DEFAULT_TREE_SETTINGS.foliage.pine.edgeNoise).toBe(DEFAULT_TREE_FOLIAGE_SETTINGS.pine.edgeNoise);
  });

  it("deep-clones tree LOD budget settings", () => {
    const cloned = cloneTreeSettings();
    expect(cloned.lod).not.toBe(DEFAULT_TREE_SETTINGS.lod);
    expect(cloned.lod.budgets).not.toBe(DEFAULT_TREE_SETTINGS.lod.budgets);
    cloned.lod.budgets.impostorMaxVertices = 1;
    expect(DEFAULT_TREE_SETTINGS.lod.budgets.impostorMaxVertices).toBe(240);
  });

  it("deep-clones tree GPU settings", () => {
    const cloned = cloneTreeSettings();
    expect(cloned.gpu).not.toBe(DEFAULT_TREE_SETTINGS.gpu);
    cloned.gpu.enabled = true;
    cloned.gpu.maxVisible = 1;
    expect(DEFAULT_TREE_SETTINGS.gpu.enabled).toBe(false);
    expect(DEFAULT_TREE_SETTINGS.gpu.maxVisible).toBe(50_000);
  });

  it("parses config/trees.yaml to the typed defaults", () => {
    expect(parseTreeConfig(treeYamlText, null)).toEqual(DEFAULT_TREE_SETTINGS);
  });

  it("uses default morphology when species morphology is missing", () => {
    const parsed = parseTreeConfig(`
trees:
  species:
    oak:
      enabled: true
      weight: 0.7
`, null);

    expect(parsed.species.oak.morphology).toEqual(DEFAULT_TREE_SETTINGS.species.oak.morphology);
    expect(parsed.species.pine.morphology).toEqual(DEFAULT_TREE_SETTINGS.species.pine.morphology);
  });

  it("uses default ecology when the ecology block is missing", () => {
    const parsed = parseTreeConfig(`
trees:
  enabled: true
`, null);

    expect(parsed.ecology).toEqual(DEFAULT_TREE_SETTINGS.ecology);
  });
});
