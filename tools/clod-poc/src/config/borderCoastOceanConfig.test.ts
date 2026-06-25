import { describe, expect, it } from "vitest";
import yamlText from "../../config/border_coast_ocean.yaml?raw";
import { parseBorderCoastOceanConfig } from "./borderCoastOceanConfig.js";

describe("border coast/ocean config", () => {
  it("parses the checked-in config", () => {
    const config = parseBorderCoastOceanConfig(yamlText);

    expect(config.world.bounds).toEqual({
      min_x: -2048,
      max_x: 2048,
      min_z: -2048,
      max_z: 2048,
    });
    expect(config.coast.type_weights).toEqual({
      sandy_beach: 0.38,
      rocky_beach: 0.2,
      cliff: 0.27,
      cove: 0.1,
      reef: 0.05,
    });
    expect(config.deep_ocean.shading.deep_color).toBe("#042c4e");
  });

  it("normalizes coast type weights", () => {
    const config = parseBorderCoastOceanConfig(
      yamlText.replace(
        /sandy_beach: 0\.38[\s\S]*?reef: 0\.05/,
        [
          "sandy_beach: 2",
          "rocky_beach: 1",
          "cliff: 1",
          "cove: 0",
          "reef: 0",
        ].join("\n    "),
      ),
    );

    expect(config.coast.type_weights).toEqual({
      sandy_beach: 0.5,
      rocky_beach: 0.25,
      cliff: 0.25,
      cove: 0,
      reef: 0,
    });
  });

  it("clamps probabilities to zero through one", () => {
    const config = parseBorderCoastOceanConfig(
      yamlText
        .replace("tide_pool_probability: 0.08", "tide_pool_probability: -2")
        .replace("ledge_probability: 0.18", "ledge_probability: 3")
        .replace("cave_mouth_probability: 0.03", "cave_mouth_probability: -1")
        .replace("sea_stack_probability: 0.04", "sea_stack_probability: 2"),
    );

    expect(config.coast.beach.tide_pool_probability).toBe(0);
    expect(config.coast.cliff.ledge_probability).toBe(1);
    expect(config.coast.cliff.cave_mouth_probability).toBe(0);
    expect(config.coast.rocky.sea_stack_probability).toBe(1);
  });

  it("fails clearly when a required section is missing", () => {
    const missingSurf = yamlText.replace(/surf:\n[\s\S]*?\ndeep_ocean:/, "deep_ocean:");

    expect(() => parseBorderCoastOceanConfig(missingSurf)).toThrow(
      "missing required section 'surf'",
    );
  });

  it("fails clearly for malformed fields", () => {
    expect(() =>
      parseBorderCoastOceanConfig(
        yamlText.replace("near_subdivisions: 128", "near_subdivisions: many"),
      ),
    ).toThrow("deep_ocean.near_subdivisions must be a finite number");
  });

  it("fails clearly for malformed YAML", () => {
    expect(() => parseBorderCoastOceanConfig("world: [")).toThrow("malformed YAML");
  });
});
