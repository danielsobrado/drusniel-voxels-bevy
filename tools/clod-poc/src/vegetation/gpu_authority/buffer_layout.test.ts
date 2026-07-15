import { describe, expect, it } from "vitest";
import commonWgsl from "./shaders/common.wgsl?raw";
import {
  ACTIVE_VEGETATION_CLUSTER_BYTES,
  VEGETATION_CLUSTER_DESCRIPTOR_BYTES,
  VEGETATION_GENERIC_INSTANCE_BYTES,
  VEGETATION_SURFACE_SAMPLE_BYTES,
  VEGETATION_SURFACE_SAMPLE_OFFSETS,
  VEGETATION_TREE_INSTANCE_BYTES,
  packActiveVegetationCluster,
  packVegetationClusterDescriptor,
  packVegetationGenericInstance,
  packVegetationSurfaceSample,
  packVegetationTreeInstance,
  unpackVegetationSurfaceSample,
  validateVegetationAuthorityCapacity,
} from "./buffer_layout.js";
import configText from "../../../config/vegetation_gpu_authority.yaml?raw";
import { parseVegetationGpuAuthorityConfig } from "./config.js";
import { VEGETATION_CATEGORY, VEGETATION_SURFACE_VALIDITY } from "./constants.js";
import type { VegetationSurfaceSample } from "./types.js";

const surfaceSample: VegetationSurfaceSample = {
  positionWs: [10, 20, 30],
  normalWs: [0.1, 0.9, -0.2],
  materialWeights: [0.4, 0.3, 0.2, 0.1],
  waterDepthM: 0.5,
  shoreDistanceM: 6,
  wetness: 0.7,
  moisture: 0.8,
  sediment: 0.25,
  deposition: 0.35,
  hardness: 0.65,
  flow: [1.5, -2.5],
  canopyCoverage: 0.6,
  canopyHeightM: 14,
  caveCoverage: 0.2,
  structureCoverage: 0.1,
  validity: VEGETATION_SURFACE_VALIDITY.CANONICAL_WITH_VOXEL,
  flags: 0xa5a5a5a5,
};

describe("vegetation authority buffer layouts", () => {
  it("packs the canonical 112-byte surface sample at explicit offsets", () => {
    const packed = packVegetationSurfaceSample(surfaceSample);
    const view = new DataView(packed);

    expect(packed.byteLength).toBe(VEGETATION_SURFACE_SAMPLE_BYTES);
    expect(view.getFloat32(VEGETATION_SURFACE_SAMPLE_OFFSETS.positionWs, true)).toBeCloseTo(10);
    expect(view.getFloat32(VEGETATION_SURFACE_SAMPLE_OFFSETS.normalWs + 4, true)).toBeCloseTo(0.9);
    expect(view.getFloat32(VEGETATION_SURFACE_SAMPLE_OFFSETS.flow + 4, true)).toBeCloseTo(-2.5);
    expect(view.getUint32(VEGETATION_SURFACE_SAMPLE_OFFSETS.validity, true)).toBe(3);
    expect(view.getUint32(VEGETATION_SURFACE_SAMPLE_OFFSETS.flags, true)).toBe(0xa5a5a5a5);

    const unpacked = unpackVegetationSurfaceSample(packed);
    expect(unpacked.positionWs).toEqual([10, 20, 30]);
    expect(unpacked.validity).toBe(surfaceSample.validity);
    expect(unpacked.flags).toBe(surfaceSample.flags);
  });

  it("packs cluster, active, generic, and tree records without implicit layout", () => {
    const descriptor = packVegetationClusterDescriptor({
      clusterX: -5,
      clusterZ: 7,
      category: VEGETATION_CATEGORY.UNDERSTORY,
      candidateCount: 361,
      terrainRevision: 4,
      providerRevision: 9,
      flags: 3,
      reserved: 0,
    });
    expect(descriptor.byteLength).toBe(VEGETATION_CLUSTER_DESCRIPTOR_BYTES);
    expect(new DataView(descriptor).getInt32(0, true)).toBe(-5);

    expect(packActiveVegetationCluster({
      descriptorIndex: 2,
      rejectionMask: 0,
      visibilityClass: 1,
      reserved: 0,
    }).byteLength).toBe(ACTIVE_VEGETATION_CLUSTER_BYTES);

    const prefix = {
      positionScale: [1, 2, 3, 1.25] as const,
      rotationNormalY: [0.5, 0.9, 2, 0] as const,
      identity: [1, 0x0002_0003, 0xfedc_ba98, 0x7654_3210] as const,
    };
    const generic = packVegetationGenericInstance({ ...prefix, render0: [0.2, 0.4, 0.6, 0.8] });
    const tree = packVegetationTreeInstance({
      ...prefix,
      morphology0: [0.1, 0.2, 0.3, 0.4],
      morphology1: [0.5, 0.6, 0.7, 0.8],
      morphology2: [0.9, 1, 1.1, 1.2],
    });
    expect(generic.byteLength).toBe(VEGETATION_GENERIC_INSTANCE_BYTES);
    expect(tree.byteLength).toBe(VEGETATION_TREE_INSTANCE_BYTES);
    expect(Array.from(new Uint32Array(tree).slice(8, 12))).toEqual(prefix.identity);
  });

  it("keeps the WGSL mirrors aligned with the TypeScript ABI", () => {
    expect(commonWgsl).toContain("struct VegetationSurfaceSample");
    expect(commonWgsl).toContain("struct VegetationClusterDescriptor");
    expect(commonWgsl).toContain("struct VegetationGenericInstance");
    expect(commonWgsl).toContain("struct VegetationTreeInstance");
    expect(commonWgsl).not.toContain("VegetationCandidate");
  });

  it("fails before allocation when a binding or preset VRAM cap is exceeded", () => {
    const config = parseVegetationGpuAuthorityConfig(configText);
    expect(validateVegetationAuthorityCapacity(config, "balanced", {
      activeClusterCapacity: 20_000,
      maxStorageBufferBindingSize: 128 * 1024 * 1024,
      counterBytes: 4096,
      indirectArgumentBytes: 4096,
    }).totalBytes).toBeGreaterThan(0);

    expect(() => validateVegetationAuthorityCapacity(config, "balanced", {
      activeClusterCapacity: 20_000,
      maxStorageBufferBindingSize: 1024,
      counterBytes: 4096,
      indirectArgumentBytes: 4096,
    })).toThrow(/binding.*trees/i);

    expect(() => validateVegetationAuthorityCapacity(config, "potato", {
      activeClusterCapacity: 20_000,
      maxStorageBufferBindingSize: 128 * 1024 * 1024,
      counterBytes: 100 * 1024 * 1024,
      indirectArgumentBytes: 4096,
    })).toThrow(/VRAM.*potato/i);

    expect(() => validateVegetationAuthorityCapacity(config, "balanced", {
      activeClusterCapacity: 1,
      maxStorageBufferBindingSize: 64 * 1024 * 1024,
      counterBytes: 65 * 1024 * 1024,
      indirectArgumentBytes: 4096,
    })).toThrow(/counter.*binding/i);

    expect(() => validateVegetationAuthorityCapacity(config, "balanced", {
      activeClusterCapacity: 1,
      maxStorageBufferBindingSize: 64 * 1024 * 1024,
      counterBytes: 4096,
      indirectArgumentBytes: 65 * 1024 * 1024,
    })).toThrow(/indirect.*binding/i);
  });
});
