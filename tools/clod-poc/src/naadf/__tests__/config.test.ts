import { describe, expect, it } from "vitest";
import { parseNaadfPocConfig } from "../config.js";
import naadfYaml from "../../../config/naadf_poc.yaml?raw";

describe("naadf config", () => {
  it("parses traversal config with dense as the safe default", () => {
    const config = parseNaadfPocConfig(naadfYaml);

    expect(config.traversal.mode).toBe("dense");
    expect(config.traversal.hddaUseDirectionalBounds).toBe(false);
    expect(config.traversal.hddaMaxChunkSteps).toBeGreaterThan(0);
    expect(config.traversal.hddaMaxBlockSteps).toBeGreaterThan(0);
    expect(config.traversal.hddaMaxVoxelSteps).toBeGreaterThan(0);
  });

  it("parses GPU far-shell height sampling as the runtime default", () => {
    const config = parseNaadfPocConfig(naadfYaml);

    expect(config.farShell.heightSamplingMode).toBe("gpu");
  });

  it("rejects invalid traversal modes", () => {
    const badYaml = naadfYaml.replace("mode: dense", "mode: unsafe-fast");

    expect(() => parseNaadfPocConfig(badYaml)).toThrow(/traversal\.mode/);
  });

  it("rejects invalid far-shell height sampling modes", () => {
    const badYaml = naadfYaml.replace("height_sampling_mode: gpu", "height_sampling_mode: cpu-ish");

    expect(() => parseNaadfPocConfig(badYaml)).toThrow(/far_shell\.height_sampling_mode/);
  });
});
