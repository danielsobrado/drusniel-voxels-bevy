import { describe, expect, it } from "vitest";
import { DEFAULT_CANOPY_SHELL_CONFIG } from "../canopy/canopy_defaults.js";
import { DEFAULT_TREE_SETTINGS } from "../trees/tree_config_defaults.js";
import { applyVegetationLodToTrees } from "./apply_vegetation_lod.js";
import {
  parseVegetationLodConfig,
  validateVegetationLodContract,
} from "./vegetation_lod_config.js";

function validConfig() {
  return parseVegetationLodConfig(`
vegetation_lod:
  canopy_handoff:
    start_m: 620
    end_m: 760
`);
}

describe("vegetation_lod_config", () => {
  it("parses a valid 620-760 handoff range", () => {
    expect(validConfig().canopyHandoff).toEqual({ startM: 620, endM: 760 });
  });

  it("fails closed when required handoff values are missing or non-numeric", () => {
    expect(() => parseVegetationLodConfig(`
vegetation_lod:
  canopy_handoff:
    end_m: 760
`)).toThrow(/start_m must be a finite number/);

    expect(() => parseVegetationLodConfig(`
vegetation_lod:
  canopy_handoff:
    start_m: null
    end_m: 760
`)).toThrow(/start_m must be a finite number/);
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
    const vegetation = validConfig();
    const trees = applyVegetationLodToTrees(structuredClone(DEFAULT_TREE_SETTINGS), vegetation);
    const canopy = structuredClone(DEFAULT_CANOPY_SHELL_CONFIG);
    expect(() => validateVegetationLodContract(vegetation, trees, canopy)).not.toThrow();
  });

  it("rejects a far-tree transition that reaches the canopy handoff", () => {
    const vegetation = parseVegetationLodConfig(`
vegetation_lod:
  canopy_handoff:
    start_m: 430
    end_m: 760
`);
    const trees = applyVegetationLodToTrees(structuredClone(DEFAULT_TREE_SETTINGS), vegetation);
    const canopy = structuredClone(DEFAULT_CANOPY_SHELL_CONFIG);
    expect(() => validateVegetationLodContract(vegetation, trees, canopy)).toThrow(
      /tree far LOD transition end/,
    );
  });

  it("rejects tree runtime settings that drift from the shared handoff", () => {
    const vegetation = validConfig();
    const trees = applyVegetationLodToTrees(structuredClone(DEFAULT_TREE_SETTINGS), vegetation);
    const canopy = structuredClone(DEFAULT_CANOPY_SHELL_CONFIG);
    trees.lod.canopyFadeStartM += 1;

    expect(() => validateVegetationLodContract(vegetation, trees, canopy)).toThrow(
      /must match the shared vegetation LOD handoff/,
    );
  });

  it("rejects handoff end beyond canopy shell end", () => {
    const vegetation = parseVegetationLodConfig(`
vegetation_lod:
  canopy_handoff:
    start_m: 620
    end_m: 9000
`);
    const trees = applyVegetationLodToTrees(structuredClone(DEFAULT_TREE_SETTINGS), vegetation);
    const canopy = structuredClone(DEFAULT_CANOPY_SHELL_CONFIG);
    expect(() => validateVegetationLodContract(vegetation, trees, canopy)).toThrow(
      /must be <= canopy shell end/,
    );
  });
});
