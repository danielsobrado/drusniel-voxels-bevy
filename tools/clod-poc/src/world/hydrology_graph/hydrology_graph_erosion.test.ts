import { describe, expect, it } from "vitest";
import { EROSION_SCHEMA_VERSION } from "../erosion/constants.js";
import type { ErosionArtifactRef, SerializedErodedMacroField } from "../erosion/types.js";
import { computeHydrologyGraphArtifactHash } from "./hydrology_graph_artifact.js";
import {
  buildHydrologyGraphFromErodedMacro,
  containsErodedMacroPosition,
} from "./hydrology_graph_erosion.js";

function field(delta = 0): SerializedErodedMacroField {
  const width = 5;
  const height = 5;
  const heightFixed = new Int32Array(width * height);
  for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) {
    heightFixed[z * width + x] = Math.round((30 - x * 2 - z + (x === 2 && z === 2 ? delta : 0)) * 256);
  }
  return {
    width,
    height,
    cellSizeM: 16,
    originX: 0,
    originZ: 0,
    heightFixed,
    hardness: new Uint16Array(width * height).fill(32768),
    sediment: new Uint32Array(width * height),
    deposition: new Int32Array(width * height),
  };
}

function ref(hashByte: string): ErosionArtifactRef {
  return {
    schemaVersion: EROSION_SCHEMA_VERSION,
    id: `erosion:${hashByte}`,
    hash: hashByte.repeat(64),
    width: 5,
    height: 5,
    cellSizeM: 16,
    originX: 0,
    originZ: 0,
    sourceTerrainHash: "a".repeat(64),
    configHash: "b".repeat(64),
  };
}

describe("erosion hydrology authority", () => {
  it("changes graph identity when the erosion artifact changes", async () => {
    const input = { worldId: "erosion-graph", seed: 9, sizeM: { x: 64, z: 64 }, originM: { x: 0, z: 0 } };
    const first = buildHydrologyGraphFromErodedMacro(input, field(0), ref("1"));
    const second = buildHydrologyGraphFromErodedMacro(input, field(-1), ref("2"));
    expect(await computeHydrologyGraphArtifactHash(second)).not.toBe(await computeHydrologyGraphArtifactHash(first));
  });

  it("rejects a resampling transform between erosion and hydrology", () => {
    expect(() => buildHydrologyGraphFromErodedMacro(
      { worldId: "erosion-graph", seed: 9, sizeM: { x: 64, z: 64 }, originM: { x: 0, z: 0 }, config: { spacingM: 8 } },
      field(),
      ref("3"),
    )).toThrow(/spacing/);
  });

  it("contains only the exact persisted erosion footprint", () => {
    const authority = field();
    expect(containsErodedMacroPosition(authority, 0, 0)).toBe(true);
    expect(containsErodedMacroPosition(authority, 64, 64)).toBe(true);
    expect(containsErodedMacroPosition(authority, -0.001, 0)).toBe(false);
    expect(containsErodedMacroPosition(authority, 64.001, 64)).toBe(false);
  });
});
