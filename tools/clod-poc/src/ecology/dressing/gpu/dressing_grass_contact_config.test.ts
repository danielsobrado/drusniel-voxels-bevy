import { describe, expect, it } from "vitest";
import {
  DRESSING_GRASS_CONTACT_STRENGTH_SCALE,
  parseDressingGrassContactConfig,
  readDressingGrassContactConfig,
} from "./dressing_grass_contact_config.js";

const valid = `
dressing_grass_contact:
  enabled: true
  field_grid: 192
  field_cell_m: 1
  core_fraction: 0.55
  classes:
    dead_log_fresh: { radius_m: 2.25, strength: 1 }
    river_cobbles: { radius_m: 0.42, strength: 0.62 }
`;

describe("dressing grass-contact config", () => {
  it("parses bounded field and class policies", () => {
    const config = parseDressingGrassContactConfig(valid);
    expect(config.enabled).toBe(true);
    expect(config.fieldGrid).toBe(192);
    expect(config.fieldCellM).toBe(1);
    expect(config.coreFraction).toBe(0.55);
    expect(config.classes.dead_log_fresh).toEqual({ radiusM: 2.25, strength: 1 });
    expect(config.classes.river_cobbles).toEqual({ radiusM: 0.42, strength: 0.62 });
    expect(DRESSING_GRASS_CONTACT_STRENGTH_SCALE).toBe(65_535);
  });

  it("rejects unknown classes and incomplete policies", () => {
    expect(() => parseDressingGrassContactConfig(valid.replace("dead_log_fresh", "unknown_log")))
      .toThrow(/unknown dressing grass-contact class/);
    expect(() => parseDressingGrassContactConfig(valid.replace("radius_m: 2.25, ", "")))
      .toThrow(/radius_m is required/);
  });

  it("rejects invalid field topology and returns defensive policy copies", () => {
    expect(() => parseDressingGrassContactConfig(valid.replace("field_grid: 192", "field_grid: 190")))
      .toThrow(/field_grid must be divisible by 8/);
    const first = readDressingGrassContactConfig();
    const second = readDressingGrassContactConfig();
    expect(first.classes).not.toBe(second.classes);
    expect(first.classes.dead_log_fresh).not.toBe(second.classes.dead_log_fresh);
  });
});
