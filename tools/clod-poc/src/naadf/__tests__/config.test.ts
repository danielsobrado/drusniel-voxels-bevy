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

  it("parses the configured GPU atlas window size", () => {
    const config = parseNaadfPocConfig(naadfYaml);

    expect(config.farShell.gpuAtlasWindowTiles).toBe(5);
  });

  it("defaults the GPU atlas window to 5 when omitted", () => {
    const yaml = naadfYaml.replace("    gpu_atlas_window_tiles: 5\n", "");
    const config = parseNaadfPocConfig(yaml);

    expect(config.farShell.gpuAtlasWindowTiles).toBe(5);
  });

  it("rejects invalid traversal modes", () => {
    const badYaml = naadfYaml.replace("mode: dense", "mode: unsafe-fast");

    expect(() => parseNaadfPocConfig(badYaml)).toThrow(/traversal\.mode/);
  });

  it("rejects invalid far-shell height sampling modes", () => {
    const badYaml = naadfYaml.replace("height_sampling_mode: gpu", "height_sampling_mode: cpu-ish");

    expect(() => parseNaadfPocConfig(badYaml)).toThrow(/far_shell\.height_sampling_mode/);
  });

  it("rejects unsupported GPU atlas window sizes", () => {
    const badYaml = naadfYaml.replace("gpu_atlas_window_tiles: 5", "gpu_atlas_window_tiles: 4");

    expect(() => parseNaadfPocConfig(badYaml)).toThrow(/far_shell\.gpu_atlas_window_tiles/);
  });
});
