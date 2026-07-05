import type { VoxelDelta } from "../terrain/voxel_edits/voxel_edit_types.js";
import {
  SAVE_VOXEL_DELTA_BINARY_HEADER_BYTES,
  SAVE_VOXEL_DELTA_BINARY_MAGIC,
  SAVE_VOXEL_DELTA_BINARY_MISSING_MATERIAL,
  SAVE_VOXEL_DELTA_BINARY_RECORD_BYTES,
  SAVE_VOXEL_DELTA_BINARY_VERSION,
} from "./save_config.js";

export type VoxelDeltaBinaryPayload = ArrayBuffer | Uint8Array;

function magicByte(index: number): number {
  return SAVE_VOXEL_DELTA_BINARY_MAGIC.charCodeAt(index);
}

function assertInt32(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < -2147483648 || value > 2147483647) {
    throw new Error(`${label} must fit int32 for bin1`);
  }
}

function assertFiniteDensity(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite for bin1`);
}

function payloadView(payload: VoxelDeltaBinaryPayload): DataView {
  if (payload instanceof ArrayBuffer) return new DataView(payload);
  if (ArrayBuffer.isView(payload)) return new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  throw new Error("bin1 voxel delta payload must be ArrayBuffer or Uint8Array");
}

function assertMagic(view: DataView): void {
  if (view.byteLength < SAVE_VOXEL_DELTA_BINARY_HEADER_BYTES) throw new Error("bin1 voxel delta payload is truncated");
  for (let i = 0; i < SAVE_VOXEL_DELTA_BINARY_MAGIC.length; i++) {
    if (view.getUint8(i) !== magicByte(i)) throw new Error("bin1 voxel delta payload has corrupt header");
  }
}

export function encodeVoxelDeltasBin1(deltas: readonly VoxelDelta[]): Uint8Array {
  const count = deltas.length;
  const bytes = SAVE_VOXEL_DELTA_BINARY_HEADER_BYTES + count * SAVE_VOXEL_DELTA_BINARY_RECORD_BYTES;
  const out = new Uint8Array(bytes);
  const view = new DataView(out.buffer);
  for (let i = 0; i < SAVE_VOXEL_DELTA_BINARY_MAGIC.length; i++) view.setUint8(i, magicByte(i));
  view.setUint16(4, SAVE_VOXEL_DELTA_BINARY_VERSION, true);
  view.setUint16(6, SAVE_VOXEL_DELTA_BINARY_HEADER_BYTES, true);
  view.setUint16(8, SAVE_VOXEL_DELTA_BINARY_RECORD_BYTES, true);
  view.setUint16(10, 0, true);
  view.setUint32(12, count, true);

  let offset = SAVE_VOXEL_DELTA_BINARY_HEADER_BYTES;
  for (let i = 0; i < deltas.length; i++) {
    const delta = deltas[i]!;
    assertInt32(delta.x, `voxel deltas[${i}].x`);
    assertInt32(delta.y, `voxel deltas[${i}].y`);
    assertInt32(delta.z, `voxel deltas[${i}].z`);
    assertInt32(delta.revision, `voxel deltas[${i}].revision`);
    assertFiniteDensity(delta.density, `voxel deltas[${i}].density`);
    const materialSlot = delta.materialSlot ?? SAVE_VOXEL_DELTA_BINARY_MISSING_MATERIAL;
    assertInt32(materialSlot, `voxel deltas[${i}].materialSlot`);
    if (delta.materialSlot === SAVE_VOXEL_DELTA_BINARY_MISSING_MATERIAL) {
      throw new Error(`voxel deltas[${i}].materialSlot is reserved for bin1`);
    }
    view.setInt32(offset, delta.x, true);
    view.setInt32(offset + 4, delta.y, true);
    view.setInt32(offset + 8, delta.z, true);
    view.setFloat64(offset + 12, delta.density, true);
    view.setInt32(offset + 20, materialSlot, true);
    view.setInt32(offset + 24, delta.revision, true);
    offset += SAVE_VOXEL_DELTA_BINARY_RECORD_BYTES;
  }
  return out;
}

export function decodeVoxelDeltasBin1(payload: VoxelDeltaBinaryPayload): VoxelDelta[] {
  const view = payloadView(payload);
  assertMagic(view);
  const version = view.getUint16(4, true);
  if (version !== SAVE_VOXEL_DELTA_BINARY_VERSION) throw new Error(`unsupported bin1 voxel delta version: ${version}`);
  const headerBytes = view.getUint16(6, true);
  const recordBytes = view.getUint16(8, true);
  if (headerBytes !== SAVE_VOXEL_DELTA_BINARY_HEADER_BYTES) throw new Error("bin1 voxel delta header size is unsupported");
  if (recordBytes !== SAVE_VOXEL_DELTA_BINARY_RECORD_BYTES) throw new Error("bin1 voxel delta record size is unsupported");
  const count = view.getUint32(12, true);
  const expectedBytes = headerBytes + count * recordBytes;
  if (view.byteLength !== expectedBytes) throw new Error("bin1 voxel delta payload length mismatch");

  const deltas: VoxelDelta[] = [];
  let offset = headerBytes;
  for (let i = 0; i < count; i++) {
    const materialSlot = view.getInt32(offset + 20, true);
    const delta: VoxelDelta = {
      x: view.getInt32(offset, true),
      y: view.getInt32(offset + 4, true),
      z: view.getInt32(offset + 8, true),
      density: view.getFloat64(offset + 12, true),
      revision: view.getInt32(offset + 24, true),
    };
    if (materialSlot !== SAVE_VOXEL_DELTA_BINARY_MISSING_MATERIAL) delta.materialSlot = materialSlot;
    assertFiniteDensity(delta.density, `voxel deltas[${i}].density`);
    deltas.push(delta);
    offset += recordBytes;
  }
  return deltas;
}
