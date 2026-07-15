import { createErosionArtifact } from "../artifact_codec.js";
import { assertErosionNotAborted, yieldErosionTask } from "../abort.js";
import { EROSION_ASYNC_CELLS_PER_YIELD, HEIGHT_UNITS_PER_METER } from "../constants.js";
import type { ErodedMacroField, ErosionGpuRawOutput, PersistedErosionArtifact } from "../types.js";
import { GPU_OUTPUT_WORDS_PER_CELL } from "./buffers.js";

async function assembleChunks(
  chunks: readonly ArrayBuffer[],
  byteLength: number,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const result = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    assertErosionNotAborted(signal);
    if (offset + chunk.byteLength > result.byteLength) throw new Error("erosion GPU output chunks exceed the declared byte length");
    result.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
    await yieldErosionTask(signal);
  }
  if (offset !== byteLength) throw new Error("erosion GPU output chunks are incomplete");
  return result.buffer;
}

async function unpackField(raw: ErosionGpuRawOutput, signal?: AbortSignal): Promise<ErodedMacroField> {
  const packed = await assembleChunks(raw.chunks, raw.byteLength, signal);
  const u32 = new Uint32Array(packed);
  const i32 = new Int32Array(packed);
  const count = raw.initial.sourceWidth * raw.initial.sourceHeight;
  if (u32.length !== count * GPU_OUTPUT_WORDS_PER_CELL) throw new Error("erosion GPU output word count mismatch");
  const heightFixed = new Int32Array(count);
  const hardness = new Uint16Array(count);
  const sediment = new Uint32Array(count);
  const deposition = new Int32Array(count);
  for (let index = 0; index < count; index++) {
    const offset = index * GPU_OUTPUT_WORDS_PER_CELL;
    heightFixed[index] = i32[offset]!;
    hardness[index] = u32[offset + 1]! & 0xffff;
    sediment[index] = u32[offset + 2]!;
    deposition[index] = i32[offset + 3]!;
    if ((index + 1) % EROSION_ASYNC_CELLS_PER_YIELD === 0) await yieldErosionTask(signal);
  }
  const field: ErodedMacroField = {
    width: raw.initial.sourceWidth,
    height: raw.initial.sourceHeight,
    cellSizeM: raw.initial.cellSizeM,
    originX: raw.initial.originX,
    originZ: raw.initial.originZ,
    heightFixed,
    hardness,
    sediment,
    deposition,
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
      const a = h00 + (h10 - h00) * tx;
      const b = h01 + (h11 - h01) * tx;
      return (a + (b - a) * tz) / HEIGHT_UNITS_PER_METER;
    },
  };
  return Object.freeze(field);
}

async function massErrorRatio(field: ErodedMacroField, signal?: AbortSignal): Promise<number> {
  let sourceMass = 0;
  let difference = 0;
  for (let index = 0; index < field.heightFixed.length; index++) {
    sourceMass += field.heightFixed[index]! * 256 - field.deposition[index]!;
    difference += field.sediment[index]! + field.deposition[index]!;
    if ((index + 1) % EROSION_ASYNC_CELLS_PER_YIELD === 0) await yieldErosionTask(signal);
  }
  if (!Number.isSafeInteger(sourceMass) || !Number.isSafeInteger(difference)) {
    throw new Error("GPU erosion mass diagnostics exceed deterministic JavaScript integer range");
  }
  return Math.abs(difference) / Math.max(1, Math.abs(sourceMass));
}

export async function finalizeErosionGpuRawOutput(input: {
  readonly raw: ErosionGpuRawOutput;
  readonly sourceTerrainHash: string;
  readonly configHash: string;
  readonly signal?: AbortSignal;
}): Promise<PersistedErosionArtifact> {
  const startedAt = performance.now();
  const field = await unpackField(input.raw, input.signal);
  const massError = await massErrorRatio(field, input.signal);
  const artifact = await createErosionArtifact({
    field,
    sourceTerrainHash: input.sourceTerrainHash,
    configHash: input.configHash,
    buildMs: input.raw.buildMs,
    samplingMs: input.raw.samplingMs,
    gpuMs: input.raw.gpuMs,
    readbackMs: input.raw.readbackMs,
    checkpointCount: input.raw.checkpointCount,
    massErrorRatio: massError,
    gpuPassTimingsMs: input.raw.gpuPassTimingsMs,
    timestampQueriesSupported: input.raw.timestampQueriesSupported,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const finalizeMs = performance.now() - startedAt;
  return Object.freeze({
    ...artifact,
    buildMs: input.raw.buildMs + finalizeMs,
    finalizeMs,
  });
}
