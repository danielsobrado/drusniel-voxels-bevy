import { describe, expect, it } from "vitest";
import { createErosionArtifact, decodeErosionArtifact } from "./artifact_codec.js";
import { EROSION_SCHEMA_VERSION } from "./constants.js";
import type { ErodedMacroField } from "./types.js";

const SOURCE_HASH = "11".repeat(32);
const CONFIG_HASH = "22".repeat(32);

function field(width = 3, height = 2): ErodedMacroField {
  const count = width * height;
  const result: ErodedMacroField = {
    width,
    height,
    cellSizeM: 16,
    originX: -16,
    originZ: 8,
    heightFixed: Int32Array.from({ length: count }, (_, index) => (index - 1) * 256),
    hardness: Uint16Array.from({ length: count }, (_, index) => index + 1),
    sediment: Uint32Array.from({ length: count }, (_, index) => index + 7),
    deposition: Int32Array.from({ length: count }, (_, index) => index % 2 === 0 ? -index : index),
    sampleHeightMeters: () => 0,
  };
  return result;
}

describe("erosion artifact codec", () => {
  it("round-trips canonical bytes through a valid zstd raw frame", async () => {
    const source = field();
    const artifact = await createErosionArtifact({
      field: source,
      sourceTerrainHash: SOURCE_HASH,
      configHash: CONFIG_HASH,
      buildMs: 1,
      checkpointCount: 2,
      massErrorRatio: 0,
    });
    const decoded = await decodeErosionArtifact({
      ref: artifact.ref,
      compressedBytes: artifact.compressedBytes,
      buildMs: artifact.buildMs,
      samplingMs: artifact.samplingMs,
      gpuMs: artifact.gpuMs,
      readbackMs: artifact.readbackMs,
      finalizeMs: artifact.finalizeMs,
      persistenceMs: artifact.persistenceMs,
      checkpointCount: artifact.checkpointCount,
      massErrorRatio: artifact.massErrorRatio,
    });
    expect(artifact.ref.schemaVersion).toBe(EROSION_SCHEMA_VERSION);
    expect(Array.from(decoded.field.heightFixed)).toEqual(Array.from(source.heightFixed));
    expect(Array.from(decoded.field.hardness)).toEqual(Array.from(source.hardness));
    expect(decoded.ref.hash).toBe(artifact.ref.hash);
    expect("canonicalBytes" in artifact).toBe(false);
  });

  it("detects corruption", async () => {
    const artifact = await createErosionArtifact({
      field: field(),
      sourceTerrainHash: SOURCE_HASH,
      configHash: CONFIG_HASH,
      buildMs: 1,
      checkpointCount: 0,
      massErrorRatio: 0,
    });
    const corrupted = artifact.compressedBytes.slice(0);
    const bytes = new Uint8Array(corrupted);
    bytes[bytes.length - 1] ^= 1;
    await expect(decodeErosionArtifact({
      ref: artifact.ref,
      compressedBytes: corrupted,
      buildMs: 1,
      gpuMs: 0,
      readbackMs: 0,
      checkpointCount: 0,
      massErrorRatio: 0,
    })).rejects.toThrow(/hash mismatch/);
  });

  it("cancels after canonical encoding has started", async () => {
    const controller = new AbortController();
    const reason = new DOMException("cancel encoding", "AbortError");
    const encoding = createErosionArtifact({
      field: field(320, 320),
      sourceTerrainHash: SOURCE_HASH,
      configHash: CONFIG_HASH,
      buildMs: 1,
      checkpointCount: 0,
      massErrorRatio: 0,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(reason), 0);
    await expect(encoding).rejects.toBe(reason);
  });
});
