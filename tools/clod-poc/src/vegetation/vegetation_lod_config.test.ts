import { describe, expect, it } from "vitest";
import { DEFAULT_CANOPY_SHELL_CONFIG } from "../canopy/canopy_defaults.js";
import { DEFAULT_TREE_SETTINGS } from "../trees/tree_config_defaults.js";
import {
  parseVegetationLodConfig,
  validateVegetationLodContract,
} from "./vegetation_lod_config.js";

describe("vegetation_lod_config", () => {
  it("parses a valid 620-760 handoff range", () => {
    const config = parseVegetationLodConfig(`
vegetation_lod:
  canopy_handoff:
    start_m: 620
    end_m: 760
`);
    expect(config.canopyHandoff).toEqual({ startM: 620, endM: 760 });
  });

  it("rejects a reversed handoff range", () => {
    expect(() => parseVegetationLodConfig(`
vegetation_lod:
  canopy_handoff:
    start_m: 760
    end_m: 620
`)).toThrow(/end_m must be greater than start_m/);
  });

  it("accepts handoff end at or below canopy shell end", () => {
    const vegetation = parseVegetationLodConfig(`
vegetation_lod:
  canopy_handoff:
    start_m: 620
    end_m: 760
`);
    const trees = structuredClone(DEFAULT_TREE_SETTINGS);
    const canopy = structuredClone(DEFAULT_CANOPY_SHELL_CONFIG);
    expect(() => validateVegetationLodContract(vegetation, trees, canopy)).not.toThrow();
  });

  it("rejects far tree boundary at or beyond handoff start", () => {
    const vegetation = parseVegetationLodConfig(`
vegetation_lod:
  canopy_handoff:
    start_m: 400
    end_m: 760
`);
    const trees = structuredClone(DEFAULT_TREE_SETTINGS);
    const canopy = structuredClone(DEFAULT_CANOPY_SHELL_CONFIG);
    expect(() => validateVegetationLodContract(vegetation, trees, canopy)).toThrow(
      /tree far LOD end/,
    );
  });

  it("rejects handoff end beyond canopy shell end", () => {
    const vegetation = parseVegetationLodConfig(`
vegetation_lod:
  canopy_handoff:
    start_m: 620
    end_m: 9000
`);
    const trees = structuredClone(DEFAULT_TREE_SETTINGS);
    const canopy = structuredClone(DEFAULT_CANOPY_SHELL_CONFIG);
    expect(() => validateVegetationLodContract(vegetation, trees, canopy)).toThrow(
      /must be <= canopy shell end/,
    );
  });
});
