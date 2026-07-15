import { describe, expect, it } from "vitest";
import configText from "../../../config/vegetation_gpu_authority.yaml?raw";
import { parseVegetationGpuAuthorityConfig } from "./config.js";

function replaceLine(source: string, from: string, to: string): string {
  const result = source.replace(from, to);
  if (result === source) throw new Error(`test fixture line not found: ${from}`);
  return result;
}

describe("vegetation GPU authority config", () => {
  it("parses the canonical cluster, distance, spacing, and capacity contracts", () => {
    const config = parseVegetationGpuAuthorityConfig(configText);

    expect(config.schemaVersion).toBe(1);
    expect(config.clusterSizeM).toBe(32);
    expect(config.clusterProbeGrid).toBe(3);
    expect(config.maximumClusterDistanceM.balanced).toEqual({
      trees: 420,
      grass: 125,
      understory: 110,
      stones: 700,
      dressing: 320,
    });
    expect(config.candidateSpacingM).toEqual({
      trees: 3.4,
      grass: 0.85,
      understory: 1.7,
      stones: 2.2,
      dressing: 1.25,
    });
    expect(config.acceptedInstanceCapacity.potato.trees).toBe(8_000);
    expect(config.authorityBufferVramMibMax.balanced).toBe(256);
    expect(config.portableStorageBindingMibMax).toBe(128);
  });

  it("rejects unknown keys at every config level", () => {
    expect(() => parseVegetationGpuAuthorityConfig(`${configText}\n  surprise: true\n`)).toThrow(/surprise/);
    const nested = replaceLine(configText, "    maximum_tree_slope_degrees: 38", "    maximum_tree_slope_degrees: 38\n    surprise: 1");
    expect(() => parseVegetationGpuAuthorityConfig(nested)).toThrow(/rejection\.surprise/);
  });

  it("rejects invalid capacities and fixed-contract drift", () => {
    const invalidCapacity = replaceLine(configText, "ultra:    { trees: 50000", "ultra:    { trees: -1");
    expect(() => parseVegetationGpuAuthorityConfig(invalidCapacity)).toThrow(/accepted_instance_capacity\.ultra\.trees/);

    const invalidClusterSize = replaceLine(configText, "  cluster_size_m: 32", "  cluster_size_m: 64");
    expect(() => parseVegetationGpuAuthorityConfig(invalidClusterSize)).toThrow(/cluster_size_m.*32/);
  });
});
