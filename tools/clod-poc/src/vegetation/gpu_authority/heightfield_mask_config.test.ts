import { describe, expect, it } from "vitest";
import configText from "../../../config/vegetation_authority_exclusions.yaml?raw";
import { VEGETATION_AUTHORITY_EXCLUDED_HEIGHT_M } from "./constants.js";
import { parseVegetationAuthorityExclusionConfig } from "./heightfield_mask_config.js";

function replaceLine(source: string, from: string, to: string): string {
  const result = source.replace(from, to);
  if (result === source) throw new Error(`test fixture line not found: ${from}`);
  return result;
}

describe("vegetation authority exclusion config", () => {
  it("parses the canonical margin, unknown radius, and per-category radii", () => {
    const config = parseVegetationAuthorityExclusionConfig(configText);

    expect(config.marginM).toBe(0.35);
    expect(config.unknownPropRadiusM).toBe(1.5);
    expect(config.propRadiusM).toEqual({
      small_decor: 0.75,
      medium_static: 2.0,
      large_static: 5.0,
      vegetation: 2.0,
      interactive: 1.5,
    });
  });

  it("rejects unknown root keys", () => {
    expect(() => parseVegetationAuthorityExclusionConfig(`${configText}\nsurprise: true\n`)).toThrow(/config\.surprise/);
  });

  it("rejects unknown exclusion keys", () => {
    const nested = replaceLine(configText, "  margin_m: 0.35", "  margin_m: 0.35\n  surprise: 1");
    expect(() => parseVegetationAuthorityExclusionConfig(nested)).toThrow(/vegetation_authority_exclusions\.surprise/);
  });

  it("rejects unknown prop category keys", () => {
    const nested = replaceLine(configText, "    interactive: 1.5", "    interactive: 1.5\n    surprise: 1");
    expect(() => parseVegetationAuthorityExclusionConfig(nested)).toThrow(/prop_radius_m\.surprise/);
  });

  it("rejects a non-mapping root", () => {
    expect(() => parseVegetationAuthorityExclusionConfig("- 1\n- 2\n")).toThrow(/must be a mapping/);
  });

  it("rejects non-finite margins", () => {
    const bad = replaceLine(configText, "  margin_m: 0.35", "  margin_m: NaN");
    expect(() => parseVegetationAuthorityExclusionConfig(bad)).toThrow(/margin_m/);
  });

  it("rejects negative margins below the minimum", () => {
    const bad = replaceLine(configText, "  margin_m: 0.35", "  margin_m: -0.1");
    expect(() => parseVegetationAuthorityExclusionConfig(bad)).toThrow(/margin_m must be a finite number >= 0/);
  });

  it("rejects non-positive unknown prop radius", () => {
    const bad = replaceLine(configText, "  unknown_prop_radius_m: 1.5", "  unknown_prop_radius_m: 0");
    expect(() => parseVegetationAuthorityExclusionConfig(bad)).toThrow(/unknown_prop_radius_m/);
  });

  it("rejects a non-positive category radius", () => {
    const bad = replaceLine(configText, "    small_decor: 0.75", "    small_decor: -1");
    expect(() => parseVegetationAuthorityExclusionConfig(bad)).toThrow(/prop_radius_m\.small_decor/);
  });

  it("rejects invalid_height_m drift from the sentinel constant", () => {
    const bad = replaceLine(configText, "  invalid_height_m: -1000000", "  invalid_height_m: -999999");
    expect(() => parseVegetationAuthorityExclusionConfig(bad)).toThrow(
      new RegExp(`invalid_height_m must be ${VEGETATION_AUTHORITY_EXCLUDED_HEIGHT_M}`),
    );
  });
});