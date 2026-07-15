import { describe, expect, it } from "vitest";
import configText from "../../../config/terrain_erosion.yaml?raw";
import { EROSION_SCHEMA_VERSION } from "./constants.js";
import { parseTerrainErosionConfig } from "./config.js";

function replaceLine(source: string, from: string, to: string): string {
  const result = source.replace(from, to);
  if (result === source) throw new Error(`test fixture line not found: ${from}`);
  return result;
}

describe("terrain erosion config", () => {
  it("parses the canonical defaults", () => {
    const config = parseTerrainErosionConfig(configText);
    expect(config.erosion.schemaVersion).toBe(EROSION_SCHEMA_VERSION);
    expect(config.erosion.cellSizeM).toBe(16);
    expect(config.erosion.hydraulicIterations).toBe(192);
    expect(config.erosion.thermalIterations).toBe(48);
  });

  it("rejects obsolete schemas", () => {
    const invalid = replaceLine(configText, "  schema_version: 2", "  schema_version: 1");
    expect(() => parseTerrainErosionConfig(invalid)).toThrow(/schema_version/);
  });

  it("rejects unknown keys", () => {
    expect(() => parseTerrainErosionConfig(`${configText}\n  surprise: true\n`)).toThrow(/surprise/);
  });

  it("rejects values outside validated ranges", () => {
    const invalid = replaceLine(configText, "  border_cells: 2", "  border_cells: 0");
    expect(() => parseTerrainErosionConfig(invalid)).toThrow(/border_cells/);
  });
});
