import { sha256Hex } from "../../cache/checksum.js";
import {
  EROSION_ARTIFACT_HEADER_BYTES,
  EROSION_ARTIFACT_MAGIC,
  EROSION_SCHEMA_VERSION,
  HEIGHT_UNITS_PER_METER,
  MAX_ZSTD_RAW_BLOCK_BYTES,
} from "./constants.js";
import type { ErodedMacroField, ErosionArtifact, ErosionArtifactRef } from "./types.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ZSTD_MAGIC = 0xfd2fb528;

function hashPrefixBytes(hash: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/i.test(hash)) throw new Error("erosion artifact hashes must be 64 hexadecimal characters");
  const bytes = new Uint8Array(16);
  for (let index = 0; index < bytes.length; index++) bytes[index] = Number.parseInt(hash.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function equalPrefix(bytes: Uint8Array, hash: string): boolean {
  const expected = hashPrefixBytes(hash);
  return bytes.every((value, index) => value === expected[index]);
}

export function canonicalErosionArtifactByteLength(width: number, height: number): number {
  const count = width * height;
  return EROSION_ARTIFACT_HEADER_BYTES + count * (Int32Array.BYTES_PER_ELEMENT + Uint16Array.BYTES_PER_ELEMENT
    + Uint32Array.BYTES_PER_ELEMENT + Int32Array.BYTES_PER_ELEMENT);
}

export function encodeErosionArtifactCanonical(
  field: ErodedMacroField,
  sourceTerrainHash: string,
  configHash: string,
): ArrayBuffer {
  const count = field.width * field.height;
  if (field.heightFixed.length !== count || field.hardness.length !== count
    || field.sediment.length !== count || field.deposition.length !== count) {
    throw new Error("erosion artifact field lengths do not match dimensions");
  }
  const buffer = new ArrayBuffer(canonicalErosionArtifactByteLength(field.width, field.height));
  const bytes = new Uint8Array(buffer);
  bytes.set(encoder.encode(EROSION_ARTIFACT_MAGIC), 0);
  const view = new DataView(buffer);
  view.setUint32(8, EROSION_SCHEMA_VERSION, true);
  view.setUint32(12, field.width, true);
  view.setUint32(16, field.height, true);
  view.setUint32(20, Math.round(field.cellSizeM * 1000), true);
  view.setInt32(24, Math.round(field.originX * 1000), true);
  view.setInt32(28, Math.round(field.originZ * 1000), true);
  bytes.set(hashPrefixBytes(sourceTerrainHash), 32);
  bytes.set(hashPrefixBytes(configHash), 48);
  let offset = EROSION_ARTIFACT_HEADER_BYTES;
  for (let index = 0; index < count; index++, offset += 4) view.setInt32(offset, field.heightFixed[index]!, true);
  for (let index = 0; index < count; index++, offset += 2) view.setUint16(offset, field.hardness[index]!, true);
  for (let index = 0; index < count; index++, offset += 4) view.setUint32(offset, field.sediment[index]!, true);
  for (let index = 0; index < count; index++, offset += 4) view.setInt32(offset, field.deposition[index]!, true);
  return buffer;
}

function fieldFromArrays(input: {
  readonly width: number;
  readonly height: number;
  readonly cellSizeM: number;
  readonly originX: number;
  readonly originZ: number;
  readonly heightFixed: Int32Array;
  readonly hardness: Uint16Array;
  readonly sediment: Uint32Array;
  readonly deposition: Int32Array;
}): ErodedMacroField {
  const field: ErodedMacroField = {
    ...input,
    sampleHeightMeters(x, z) {
      const fx = Math.max(0, Math.min(field.width - 1, (x - field.originX) / field.cellSizeM));
      const fz = Math.max(0, Math.min(field.height - 1, (z - field.originZ) / field.cellSizeM));
      const x0 = Math.floor(fx);
      const z0 = Math.floor(fz);
      const x1 = Math.min(field.width - 1, x0 + 1);
      const z1 = Math.min(field.height - 1, z0 + 1);
      const tx = fx - x0;
      const tz = fz - z0;
      const h00 = field.heightFixed[z0 * field.width + x0]!;
      const h10 = field.heightFixed[z0 * field.width + x1]!;
      const h01 = field.heightFixed[z1 * field.width + x0]!;
      const h11 = field.heightFixed[z1 * field.width + x1]!;
      return ((h00 + (h10 - h00) * tx) + ((h01 + (h11 - h01) * tx) - (h00 + (h10 - h00) * tx)) * tz)
        / HEIGHT_UNITS_PER_METER;
    },
  };
  return Object.freeze(field);
}

export function decodeErosionArtifactCanonical(
  canonicalBytes: ArrayBuffer,
  expected: Pick<ErosionArtifactRef, "sourceTerrainHash" | "configHash">,
): ErodedMacroField {
  if (canonicalBytes.byteLength < EROSION_ARTIFACT_HEADER_BYTES) throw new Error("erosion artifact is shorter than its header");
  const bytes = new Uint8Array(canonicalBytes);
  if (decoder.decode(bytes.subarray(0, 8)) !== EROSION_ARTIFACT_MAGIC) throw new Error("erosion artifact magic mismatch");
  const view = new DataView(canonicalBytes);
  if (view.getUint32(8, true) !== EROSION_SCHEMA_VERSION) throw new Error("erosion artifact schema mismatch");
  const width = view.getUint32(12, true);
  const height = view.getUint32(16, true);
  const cellSizeM = view.getUint32(20, true) / 1000;
  const originX = view.getInt32(24, true) / 1000;
  const originZ = view.getInt32(28, true) / 1000;
  if (width < 2 || height < 2 || !Number.isSafeInteger(width * height)) throw new Error("erosion artifact dimensions are invalid");
  if (canonicalBytes.byteLength !== canonicalErosionArtifactByteLength(width, height)) throw new Error("erosion artifact byte length mismatch");
  if (!equalPrefix(bytes.subarray(32, 48), expected.sourceTerrainHash)) throw new Error("erosion artifact source terrain hash mismatch");
  if (!equalPrefix(bytes.subarray(48, 64), expected.configHash)) throw new Error("erosion artifact config hash mismatch");
  const count = width * height;
  const heightFixed = new Int32Array(count);
  const hardness = new Uint16Array(count);
  const sediment = new Uint32Array(count);
  const deposition = new Int32Array(count);
  let offset = EROSION_ARTIFACT_HEADER_BYTES;
  for (let index = 0; index < count; index++, offset += 4) heightFixed[index] = view.getInt32(offset, true);
  for (let index = 0; index < count; index++, offset += 2) hardness[index] = view.getUint16(offset, true);
  for (let index = 0; index < count; index++, offset += 4) sediment[index] = view.getUint32(offset, true);
  for (let index = 0; index < count; index++, offset += 4) deposition[index] = view.getInt32(offset, true);
  return fieldFromArrays({ width, height, cellSizeM, originX, originZ, heightFixed, hardness, sediment, deposition });
}

export function encodeZstdRawFrame(canonicalBytes: ArrayBuffer): ArrayBuffer {
  if (canonicalBytes.byteLength > 0xffffffff) throw new Error("erosion artifact exceeds zstd single-segment size limit");
  const blockCount = Math.max(1, Math.ceil(canonicalBytes.byteLength / MAX_ZSTD_RAW_BLOCK_BYTES));
  const output = new Uint8Array(4 + 1 + 4 + blockCount * 3 + canonicalBytes.byteLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, ZSTD_MAGIC, true);
  output[4] = 0xa0;
  view.setUint32(5, canonicalBytes.byteLength, true);
  const input = new Uint8Array(canonicalBytes);
  let inputOffset = 0;
  let outputOffset = 9;
  for (let block = 0; block < blockCount; block++) {
    const size = Math.min(MAX_ZSTD_RAW_BLOCK_BYTES, input.length - inputOffset);
    const last = block === blockCount - 1 ? 1 : 0;
    const header = (size << 3) | last;
    output[outputOffset++] = header & 0xff;
    output[outputOffset++] = (header >>> 8) & 0xff;
    output[outputOffset++] = (header >>> 16) & 0xff;
    output.set(input.subarray(inputOffset, inputOffset + size), outputOffset);
    inputOffset += size;
    outputOffset += size;
  }
  return output.buffer;
}

export function decodeZstdRawFrame(compressedBytes: ArrayBuffer): ArrayBuffer {
  if (compressedBytes.byteLength < 12) throw new Error("erosion zstd frame is truncated");
  const input = new Uint8Array(compressedBytes);
  const view = new DataView(compressedBytes);
  if (view.getUint32(0, true) !== ZSTD_MAGIC) throw new Error("erosion zstd magic mismatch");
  if (input[4] !== 0xa0) throw new Error("erosion zstd frame uses unsupported compression features");
  const contentSize = view.getUint32(5, true);
  const output = new Uint8Array(contentSize);
  let inputOffset = 9;
  let outputOffset = 0;
  let last = false;
  while (!last) {
    if (inputOffset + 3 > input.length) throw new Error("erosion zstd block header is truncated");
    const header = input[inputOffset]! | (input[inputOffset + 1]! << 8) | (input[inputOffset + 2]! << 16);
    inputOffset += 3;
    last = (header & 1) === 1;
    const blockType = (header >>> 1) & 0x3;
    const blockSize = header >>> 3;
    if (blockType !== 0) throw new Error("erosion zstd frame contains a non-raw block");
    if (inputOffset + blockSize > input.length || outputOffset + blockSize > output.length) {
      throw new Error("erosion zstd raw block exceeds frame bounds");
    }
    output.set(input.subarray(inputOffset, inputOffset + blockSize), outputOffset);
    inputOffset += blockSize;
    outputOffset += blockSize;
  }
  if (outputOffset !== contentSize || inputOffset !== input.length) throw new Error("erosion zstd content size mismatch");
  return output.buffer;
}

export async function createErosionArtifact(input: {
  readonly field: ErodedMacroField;
  readonly sourceTerrainHash: string;
  readonly configHash: string;
  readonly buildMs: number;
  readonly gpuMs?: number;
  readonly readbackMs?: number;
  readonly checkpointCount: number;
  readonly massErrorRatio: number;
}): Promise<ErosionArtifact> {
  const canonicalBytes = encodeErosionArtifactCanonical(input.field, input.sourceTerrainHash, input.configHash);
  const hash = await sha256Hex(canonicalBytes);
  const compressedBytes = encodeZstdRawFrame(canonicalBytes);
  const ref: ErosionArtifactRef = Object.freeze({
    schemaVersion: EROSION_SCHEMA_VERSION,
    id: `erosion:${hash.slice(0, 16)}`,
    hash,
    width: input.field.width,
    height: input.field.height,
    cellSizeM: input.field.cellSizeM,
    originX: input.field.originX,
    originZ: input.field.originZ,
    sourceTerrainHash: input.sourceTerrainHash,
    configHash: input.configHash,
  });
  return Object.freeze({
    ref,
    field: input.field,
    canonicalBytes,
    compressedBytes,
    buildMs: input.buildMs,
    gpuMs: input.gpuMs ?? 0,
    readbackMs: input.readbackMs ?? 0,
    checkpointCount: input.checkpointCount,
    massErrorRatio: input.massErrorRatio,
  });
}

export async function decodeErosionArtifact(input: {
  readonly ref: ErosionArtifactRef;
  readonly compressedBytes: ArrayBuffer;
  readonly buildMs: number;
  readonly gpuMs: number;
  readonly readbackMs: number;
  readonly checkpointCount: number;
  readonly massErrorRatio: number;
}): Promise<ErosionArtifact> {
  const canonicalBytes = decodeZstdRawFrame(input.compressedBytes);
  const hash = await sha256Hex(canonicalBytes);
  if (hash !== input.ref.hash) throw new Error("erosion artifact canonical hash mismatch");
  const field = decodeErosionArtifactCanonical(canonicalBytes, input.ref);
  if (field.width !== input.ref.width || field.height !== input.ref.height || field.cellSizeM !== input.ref.cellSizeM
    || field.originX !== input.ref.originX || field.originZ !== input.ref.originZ) {
    throw new Error("erosion artifact reference does not match its header");
  }
  return Object.freeze({ ...input, field, canonicalBytes });
}
