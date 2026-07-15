import { describe, expect, it } from "vitest";
import { createErosionArtifact, decodeErosionArtifact } from "./artifact_codec.js";
import type { ErodedMacroField } from "./types.js";

const SOURCE_HASH = "11".repeat(32);
const CONFIG_HASH = "22".repeat(32);

function field(): ErodedMacroField {
  const result: ErodedMacroField = {
    width: 3,
    height: 2,
    cellSizeM: 16,
    originX: -16,
    originZ: 8,
    heightFixed: Int32Array.from([0, 256, 512, -256, 1024, 2048]),
    hardness: Uint16Array.from([1, 2, 3, 4, 5, 6]),
    sediment: Uint32Array.from([7, 8, 9, 10, 11, 12]),
    deposition: Int32Array.from([-13, -14, 15, 16, 17, 18]),
    sampleHeightMeters: () => 0,
  };
  return result;
}

describe("erosion artifact codec", () => {
  it("round-trips canonical bytes through a valid zstd raw frame", async () => {
    const artifact = await createErosionArtifact({
      field: field(),
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
      gpuMs: artifact.gpuMs,
      readbackMs: artifact.readbackMs,
      checkpointCount: artifact.checkpointCount,
      massErrorRatio: artifact.massErrorRatio,
    });
    expect(Array.from(decoded.field.heightFixed)).toEqual(Array.from(field().heightFixed));
    expect(Array.from(decoded.field.hardness)).toEqual(Array.from(field().hardness));
    expect(decoded.ref.hash).toBe(artifact.ref.hash);
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
});
