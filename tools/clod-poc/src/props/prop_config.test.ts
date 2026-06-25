import { describe, expect, it } from "vitest";
import customPropsYaml from "../../config/custom_props.yaml?raw";
import { DEFAULT_CUSTOM_PROPS_SETTINGS, parseCustomPropsConfig, propDefById } from "./prop_config.js";
import { validateCustomPropsManifest } from "./prop_asset_validate.js";

describe("parseCustomPropsConfig", () => {
  it("parses the repo custom_props.yaml manifest", () => {
    const settings = parseCustomPropsConfig(customPropsYaml);
    expect(settings.enabled).toBe(false);
    expect(settings.spatial.cellSizeM).toBe(64);
    expect(settings.props).toHaveLength(3);
    const ruin = settings.props.find((p) => p.id === "stone_ruin_wall");
    expect(ruin?.category).toBe("large_static");
    expect(ruin?.lod.billboardFrom).toBe(180);
    expect(ruin?.lightingProxy?.affectGi).toBe(true);
  });

  it("falls back to defaults for an empty document", () => {
    const settings = parseCustomPropsConfig("");
    expect(settings.enabled).toBe(DEFAULT_CUSTOM_PROPS_SETTINGS.enabled);
    expect(settings.props).toHaveLength(0);
    expect(settings.culling.hysteresisM).toBe(8);
  });

  it("validates the bundled manifest", () => {
    const settings = parseCustomPropsConfig(customPropsYaml);
    const report = validateCustomPropsManifest(settings);
    expect(report.ok).toBe(true);
    const byId = propDefById(settings);
    expect(byId.get("crate_a")?.culling.maxDistance).toBe(140);
  });
});
