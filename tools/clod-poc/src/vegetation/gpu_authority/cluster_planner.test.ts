import { describe, expect, it } from "vitest";
import configText from "../../../config/vegetation_gpu_authority.yaml?raw";
import { parseVegetationGpuAuthorityConfig } from "./config.js";
import { VEGETATION_CATEGORY_NAMES } from "./constants.js";
import {
  planVegetationClusterDescriptors,
  vegetationClusterDescriptorCapacity,
} from "./cluster_planner.js";

const config = parseVegetationGpuAuthorityConfig(configText);

describe("vegetation authority cluster planner", () => {
  it("uploads only stable descriptors while the camera stays in one snapped cluster", () => {
    const base = {
      config,
      quality: "balanced" as const,
      terrainRevision: 4,
      providerRevision: 7,
    };
    const first = planVegetationClusterDescriptors({ ...base, cameraWorldX: 0.1, cameraWorldZ: 31.9 });
    const second = planVegetationClusterDescriptors({ ...base, cameraWorldX: 31.9, cameraWorldZ: 0.1 });

    expect(second).toEqual(first);
    expect(first).toHaveLength(vegetationClusterDescriptorCapacity(config, "balanced"));
    expect(new Set(first.map((entry) => `${entry.category}:${entry.clusterX}:${entry.clusterZ}`)).size)
      .toBe(first.length);
  });

  it("derives category ranges and exact candidate counts instead of CPU candidate arrays", () => {
    const descriptors = planVegetationClusterDescriptors({
      config,
      quality: "potato",
      cameraWorldX: -0.1,
      cameraWorldZ: -0.1,
      terrainRevision: 11,
      providerRevision: 13,
    });

    expect(new Set(descriptors.map((entry) => entry.category)).size).toBe(VEGETATION_CATEGORY_NAMES.length);
    expect(descriptors.every((entry) => entry.candidateCount > 0)).toBe(true);
    expect(descriptors.every((entry) => entry.terrainRevision === 11 && entry.providerRevision === 13)).toBe(true);
    expect(Object.keys(descriptors[0]).sort()).toEqual([
      "candidateCount",
      "category",
      "clusterX",
      "clusterZ",
      "flags",
      "providerRevision",
      "reserved",
      "terrainRevision",
    ]);
  });
});
