import {
  VEGETATION_CATEGORY_NAMES,
  type VegetationCategoryName,
  type VegetationSurfaceValidity,
} from "./constants.js";
import type { VegetationGpuAuthorityConfig, VegetationQualityPreset } from "./config.js";
import type {
  ActiveVegetationCluster,
  Vec2,
  Vec3,
  Vec4,
  VegetationClusterDescriptor,
  VegetationGenericInstance,
  VegetationInstancePrefix,
  VegetationSurfaceSample,
  VegetationTreeInstance,
} from "./types.js";

export const VEGETATION_CLUSTER_DESCRIPTOR_BYTES = 32;
export const ACTIVE_VEGETATION_CLUSTER_BYTES = 16;
export const VEGETATION_SURFACE_SAMPLE_BYTES = 112;
export const VEGETATION_GENERIC_INSTANCE_BYTES = 64;
export const VEGETATION_TREE_INSTANCE_BYTES = 96;

export const VEGETATION_SURFACE_SAMPLE_OFFSETS = {
  positionWs: 0,
  normalWs: 16,
  materialWeights: 32,
  waterDepthM: 48,
  shoreDistanceM: 52,
  wetness: 56,
  moisture: 60,
  sediment: 64,
  deposition: 68,
  hardness: 72,
  flow: 80,
  canopyCoverage: 88,
  canopyHeightM: 92,
  caveCoverage: 96,
  structureCoverage: 100,
  validity: 104,
  flags: 108,
} as const;

const MIB = 1024 * 1024;

function writeFloatVector(view: DataView, byteOffset: number, values: readonly number[]): void {
  values.forEach((value, index) => view.setFloat32(byteOffset + index * 4, value, true));
}

function readVec2(view: DataView, byteOffset: number): Vec2 {
  return [view.getFloat32(byteOffset, true), view.getFloat32(byteOffset + 4, true)];
}

function readVec3(view: DataView, byteOffset: number): Vec3 {
  return [
    view.getFloat32(byteOffset, true),
    view.getFloat32(byteOffset + 4, true),
    view.getFloat32(byteOffset + 8, true),
  ];
}

function readVec4(view: DataView, byteOffset: number): Vec4 {
  return [
    view.getFloat32(byteOffset, true),
    view.getFloat32(byteOffset + 4, true),
    view.getFloat32(byteOffset + 8, true),
    view.getFloat32(byteOffset + 12, true),
  ];
}

function writePrefix(view: DataView, input: VegetationInstancePrefix): void {
  writeFloatVector(view, 0, input.positionScale);
  writeFloatVector(view, 16, input.rotationNormalY);
  input.identity.forEach((value, index) => view.setUint32(32 + index * 4, value >>> 0, true));
}

function checkedU32(value: number, path: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) throw new Error(`${path} must be a u32`);
  return value >>> 0;
}

function checkedI32(value: number, path: string): number {
  if (!Number.isSafeInteger(value) || value < -0x8000_0000 || value > 0x7fff_ffff) throw new Error(`${path} must be an i32`);
  return value | 0;
}

export function packVegetationSurfaceSample(input: VegetationSurfaceSample): ArrayBuffer {
  const buffer = new ArrayBuffer(VEGETATION_SURFACE_SAMPLE_BYTES);
  const view = new DataView(buffer);
  writeFloatVector(view, VEGETATION_SURFACE_SAMPLE_OFFSETS.positionWs, input.positionWs);
  writeFloatVector(view, VEGETATION_SURFACE_SAMPLE_OFFSETS.normalWs, input.normalWs);
  writeFloatVector(view, VEGETATION_SURFACE_SAMPLE_OFFSETS.materialWeights, input.materialWeights);
  view.setFloat32(VEGETATION_SURFACE_SAMPLE_OFFSETS.waterDepthM, input.waterDepthM, true);
  view.setFloat32(VEGETATION_SURFACE_SAMPLE_OFFSETS.shoreDistanceM, input.shoreDistanceM, true);
  view.setFloat32(VEGETATION_SURFACE_SAMPLE_OFFSETS.wetness, input.wetness, true);
  view.setFloat32(VEGETATION_SURFACE_SAMPLE_OFFSETS.moisture, input.moisture, true);
  view.setFloat32(VEGETATION_SURFACE_SAMPLE_OFFSETS.sediment, input.sediment, true);
  view.setFloat32(VEGETATION_SURFACE_SAMPLE_OFFSETS.deposition, input.deposition, true);
  view.setFloat32(VEGETATION_SURFACE_SAMPLE_OFFSETS.hardness, input.hardness, true);
  writeFloatVector(view, VEGETATION_SURFACE_SAMPLE_OFFSETS.flow, input.flow);
  view.setFloat32(VEGETATION_SURFACE_SAMPLE_OFFSETS.canopyCoverage, input.canopyCoverage, true);
  view.setFloat32(VEGETATION_SURFACE_SAMPLE_OFFSETS.canopyHeightM, input.canopyHeightM, true);
  view.setFloat32(VEGETATION_SURFACE_SAMPLE_OFFSETS.caveCoverage, input.caveCoverage, true);
  view.setFloat32(VEGETATION_SURFACE_SAMPLE_OFFSETS.structureCoverage, input.structureCoverage, true);
  view.setUint32(VEGETATION_SURFACE_SAMPLE_OFFSETS.validity, checkedU32(input.validity, "validity"), true);
  view.setUint32(VEGETATION_SURFACE_SAMPLE_OFFSETS.flags, checkedU32(input.flags, "flags"), true);
  return buffer;
}

export function unpackVegetationSurfaceSample(buffer: ArrayBufferLike, byteOffset = 0): VegetationSurfaceSample {
  if (byteOffset < 0 || byteOffset + VEGETATION_SURFACE_SAMPLE_BYTES > buffer.byteLength) {
    throw new Error("vegetation surface sample is outside the supplied buffer");
  }
  const view = new DataView(buffer, byteOffset, VEGETATION_SURFACE_SAMPLE_BYTES);
  return {
    positionWs: readVec3(view, VEGETATION_SURFACE_SAMPLE_OFFSETS.positionWs),
    normalWs: readVec3(view, VEGETATION_SURFACE_SAMPLE_OFFSETS.normalWs),
    materialWeights: readVec4(view, VEGETATION_SURFACE_SAMPLE_OFFSETS.materialWeights),
    waterDepthM: view.getFloat32(VEGETATION_SURFACE_SAMPLE_OFFSETS.waterDepthM, true),
    shoreDistanceM: view.getFloat32(VEGETATION_SURFACE_SAMPLE_OFFSETS.shoreDistanceM, true),
    wetness: view.getFloat32(VEGETATION_SURFACE_SAMPLE_OFFSETS.wetness, true),
    moisture: view.getFloat32(VEGETATION_SURFACE_SAMPLE_OFFSETS.moisture, true),
    sediment: view.getFloat32(VEGETATION_SURFACE_SAMPLE_OFFSETS.sediment, true),
    deposition: view.getFloat32(VEGETATION_SURFACE_SAMPLE_OFFSETS.deposition, true),
    hardness: view.getFloat32(VEGETATION_SURFACE_SAMPLE_OFFSETS.hardness, true),
    flow: readVec2(view, VEGETATION_SURFACE_SAMPLE_OFFSETS.flow),
    canopyCoverage: view.getFloat32(VEGETATION_SURFACE_SAMPLE_OFFSETS.canopyCoverage, true),
    canopyHeightM: view.getFloat32(VEGETATION_SURFACE_SAMPLE_OFFSETS.canopyHeightM, true),
    caveCoverage: view.getFloat32(VEGETATION_SURFACE_SAMPLE_OFFSETS.caveCoverage, true),
    structureCoverage: view.getFloat32(VEGETATION_SURFACE_SAMPLE_OFFSETS.structureCoverage, true),
    validity: view.getUint32(VEGETATION_SURFACE_SAMPLE_OFFSETS.validity, true) as VegetationSurfaceValidity,
    flags: view.getUint32(VEGETATION_SURFACE_SAMPLE_OFFSETS.flags, true),
  };
}

export function packVegetationClusterDescriptor(input: VegetationClusterDescriptor): ArrayBuffer {
  const buffer = new ArrayBuffer(VEGETATION_CLUSTER_DESCRIPTOR_BYTES);
  const view = new DataView(buffer);
  view.setInt32(0, checkedI32(input.clusterX, "clusterX"), true);
  view.setInt32(4, checkedI32(input.clusterZ, "clusterZ"), true);
  view.setUint32(8, checkedU32(input.category, "category"), true);
  view.setUint32(12, checkedU32(input.candidateCount, "candidateCount"), true);
  view.setUint32(16, checkedU32(input.terrainRevision, "terrainRevision"), true);
  view.setUint32(20, checkedU32(input.providerRevision, "providerRevision"), true);
  view.setUint32(24, checkedU32(input.flags, "flags"), true);
  view.setUint32(28, checkedU32(input.reserved, "reserved"), true);
  return buffer;
}

export function packActiveVegetationCluster(input: ActiveVegetationCluster): ArrayBuffer {
  const buffer = new ArrayBuffer(ACTIVE_VEGETATION_CLUSTER_BYTES);
  const view = new DataView(buffer);
  view.setUint32(0, checkedU32(input.descriptorIndex, "descriptorIndex"), true);
  view.setUint32(4, checkedU32(input.rejectionMask, "rejectionMask"), true);
  view.setUint32(8, checkedU32(input.visibilityClass, "visibilityClass"), true);
  view.setUint32(12, checkedU32(input.reserved, "reserved"), true);
  return buffer;
}

export function packVegetationGenericInstance(input: VegetationGenericInstance): ArrayBuffer {
  const buffer = new ArrayBuffer(VEGETATION_GENERIC_INSTANCE_BYTES);
  const view = new DataView(buffer);
  writePrefix(view, input);
  writeFloatVector(view, 48, input.render0);
  return buffer;
}

export function packVegetationTreeInstance(input: VegetationTreeInstance): ArrayBuffer {
  const buffer = new ArrayBuffer(VEGETATION_TREE_INSTANCE_BYTES);
  const view = new DataView(buffer);
  writePrefix(view, input);
  writeFloatVector(view, 48, input.morphology0);
  writeFloatVector(view, 64, input.morphology1);
  writeFloatVector(view, 80, input.morphology2);
  return buffer;
}

export interface VegetationAuthorityCapacityOptions {
  readonly activeClusterCapacity: number;
  readonly maxStorageBufferBindingSize: number;
  readonly counterBytes: number;
  readonly indirectArgumentBytes: number;
}

export interface VegetationAuthorityCapacityReport {
  readonly totalBytes: number;
  readonly acceptedInstanceBytesPerBuffer: Readonly<Record<VegetationCategoryName, number>>;
  readonly acceptedInstanceDoubleBufferBytes: number;
  readonly clusterDescriptorBytes: number;
  readonly activeClusterBytes: number;
  readonly overheadBytes: number;
  readonly bindingLimitBytes: number;
  readonly presetLimitBytes: number;
}

function nonNegativeInteger(value: number, path: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${path} must be a non-negative safe integer`);
  return value;
}

function recordBytes(category: VegetationCategoryName): number {
  return category === "trees" ? VEGETATION_TREE_INSTANCE_BYTES : VEGETATION_GENERIC_INSTANCE_BYTES;
}

export function validateVegetationAuthorityCapacity(
  config: VegetationGpuAuthorityConfig,
  quality: VegetationQualityPreset,
  options: VegetationAuthorityCapacityOptions,
): VegetationAuthorityCapacityReport {
  const maxStorageBufferBindingSize = nonNegativeInteger(
    options.maxStorageBufferBindingSize,
    "maxStorageBufferBindingSize",
  );
  if (maxStorageBufferBindingSize === 0) throw new Error("maxStorageBufferBindingSize must be positive");
  const portableLimitBytes = config.portableStorageBindingMibMax * MIB;
  const bindingLimitBytes = Math.min(maxStorageBufferBindingSize, portableLimitBytes);
  const capacities = config.acceptedInstanceCapacity[quality];
  const acceptedInstanceBytesPerBuffer = Object.fromEntries(VEGETATION_CATEGORY_NAMES.map((category) => {
    const bytes = capacities[category] * recordBytes(category);
    if (!Number.isSafeInteger(bytes)) throw new Error(`vegetation authority ${category} binding size is unsafe`);
    if (bytes > bindingLimitBytes) {
      throw new Error(`vegetation authority storage binding for ${category} requires ${bytes} bytes; limit is ${bindingLimitBytes}`);
    }
    return [category, bytes];
  })) as Record<VegetationCategoryName, number>;

  const activeClusterCapacity = nonNegativeInteger(options.activeClusterCapacity, "activeClusterCapacity");
  const clusterDescriptorBytes = activeClusterCapacity * VEGETATION_CLUSTER_DESCRIPTOR_BYTES;
  const activeClusterBytes = activeClusterCapacity * ACTIVE_VEGETATION_CLUSTER_BYTES;
  if (clusterDescriptorBytes > bindingLimitBytes) throw new Error("vegetation authority cluster descriptor binding exceeds the storage limit");
  if (activeClusterBytes > bindingLimitBytes) throw new Error("vegetation authority active cluster binding exceeds the storage limit");

  const counterBytes = nonNegativeInteger(options.counterBytes, "counterBytes");
  const indirectArgumentBytes = nonNegativeInteger(options.indirectArgumentBytes, "indirectArgumentBytes");
  if (counterBytes > bindingLimitBytes) {
    throw new Error("vegetation authority counter binding exceeds the storage limit");
  }
  if (indirectArgumentBytes > bindingLimitBytes) {
    throw new Error("vegetation authority indirect argument binding exceeds the storage limit");
  }
  const acceptedInstanceDoubleBufferBytes = VEGETATION_CATEGORY_NAMES.reduce(
    (sum, category) => sum + acceptedInstanceBytesPerBuffer[category] * 2,
    0,
  );
  const overheadBytes = counterBytes + indirectArgumentBytes;
  const totalBytes = acceptedInstanceDoubleBufferBytes
    + clusterDescriptorBytes
    + activeClusterBytes
    + overheadBytes;
  const presetLimitBytes = config.authorityBufferVramMibMax[quality] * MIB;
  if (totalBytes > presetLimitBytes) {
    throw new Error(`vegetation authority VRAM for ${quality} requires ${totalBytes} bytes; cap is ${presetLimitBytes}`);
  }

  return Object.freeze({
    totalBytes,
    acceptedInstanceBytesPerBuffer: Object.freeze(acceptedInstanceBytesPerBuffer),
    acceptedInstanceDoubleBufferBytes,
    clusterDescriptorBytes,
    activeClusterBytes,
    overheadBytes,
    bindingLimitBytes,
    presetLimitBytes,
  });
}
