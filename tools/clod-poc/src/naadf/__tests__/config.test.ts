import { describe, expect, it } from "vitest";
import { DEFAULT_FAR_SUMMARY_ATLAS_FORMAT, DEFAULT_NAADF_FAR_SHELL_HEIGHT_SAMPLING_MODE, parseNaadfPocConfig } from "../config.js";
import {
  DEFAULT_FAR_SUMMARY_ATLAS_DIRTY_RECT_UPLOADS,
  DEFAULT_FAR_SUMMARY_ATLAS_FULL_UPLOAD_THRESHOLD_PCT,
  DEFAULT_FAR_SUMMARY_ATLAS_MAX_DIRTY_RECTS_PER_TEXTURE,
} from "../farSummaryAtlasUploadConfig.js";
import naadfYaml from "../../../config/naadf_poc.yaml?raw";

function withoutFarSummaryAtlasSection(yaml: string): string {
  return yaml.replace(/\n  far_summary_atlas:\n(?:    .+\n)+(?=\n  query:)/, "\n");
}

function withFarSummaryAtlasFormat(yaml: string, format: string): string {
  return yaml.replace(/(\r?\n\s+far_summary_atlas:\r?\n\s+format:\s*).+\r?(\n|$)/, `$1${format}$2`);
}

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

    expect(DEFAULT_NAADF_FAR_SHELL_HEIGHT_SAMPLING_MODE).toBe("gpu");
    expect(config.farShell.heightSamplingMode).toBe("gpu");
  });

  it("defaults far-shell height sampling to GPU when omitted", () => {
    const yaml = naadfYaml.replace("    height_sampling_mode: gpu\n", "");
    const config = parseNaadfPocConfig(yaml);

    expect(config.farShell.heightSamplingMode).toBe("gpu");
  });

  it("allows explicit CPU far-shell height sampling only as an override", () => {
    const yaml = naadfYaml.replace("height_sampling_mode: gpu", "height_sampling_mode: cpu");
    const config = parseNaadfPocConfig(yaml);

    expect(config.farShell.heightSamplingMode).toBe("cpu");
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

  it("parses configured balanced far-summary atlas packing", () => {
    const config = parseNaadfPocConfig(naadfYaml);

    expect(DEFAULT_FAR_SUMMARY_ATLAS_FORMAT).toBe("balanced");
    expect(config.farSummaryAtlas.format).toBe("balanced");
    expect(config.farSummaryAtlas.dirtyRectUploads).toBe(true);
    expect(config.farSummaryAtlas.fullUploadThresholdPct).toBe(0.35);
    expect(config.farSummaryAtlas.maxDirtyRectsPerTexture).toBe(128);
  });

  it("defaults far-summary atlas packing to balanced when omitted", () => {
    const config = parseNaadfPocConfig(withoutFarSummaryAtlasSection(naadfYaml));

    expect(config.farSummaryAtlas.format).toBe("balanced");
    expect(config.farSummaryAtlas.dirtyRectUploads).toBe(DEFAULT_FAR_SUMMARY_ATLAS_DIRTY_RECT_UPLOADS);
    expect(config.farSummaryAtlas.fullUploadThresholdPct).toBe(DEFAULT_FAR_SUMMARY_ATLAS_FULL_UPLOAD_THRESHOLD_PCT);
    expect(config.farSummaryAtlas.maxDirtyRectsPerTexture).toBe(DEFAULT_FAR_SUMMARY_ATLAS_MAX_DIRTY_RECTS_PER_TEXTURE);
  });

  it("allows debug RGBA32F far-summary atlas packing for validation", () => {
    const config = parseNaadfPocConfig(withFarSummaryAtlasFormat(naadfYaml, "debug_rgba32f"));

    expect(config.farSummaryAtlas.format).toBe("debug_rgba32f");
  });

  it("allows packed far-summary atlas packing", () => {
    const config = parseNaadfPocConfig(withFarSummaryAtlasFormat(naadfYaml, "packed"));

    expect(config.farSummaryAtlas.format).toBe("packed");
  });

  it("keeps packed_low_bandwidth far-summary atlas packing as a legacy alias", () => {
    const config = parseNaadfPocConfig(withFarSummaryAtlasFormat(naadfYaml, "packed_low_bandwidth"));

    expect(config.farSummaryAtlas.format).toBe("packed_low_bandwidth");
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

  it("rejects invalid far-summary atlas packing formats", () => {
    const badYaml = withFarSummaryAtlasFormat(naadfYaml, "huge_float_debug");

    expect(() => parseNaadfPocConfig(badYaml)).toThrow(/far_summary_atlas\.format/);
  });
});
