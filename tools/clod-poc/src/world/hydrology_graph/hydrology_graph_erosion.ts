import { HEIGHT_UNITS_PER_METER } from "../erosion/constants.js";
import type { ErosionArtifactRef, SerializedErodedMacroField } from "../erosion/types.js";
import type { BuildHydrologyGraphInput, HydrologyGraph, HydrologyMacroSampleCheckpoint } from "./hydrology_graph.js";
import { buildHydrologyGraphFromMacro } from "./hydrology_graph_builder.js";

export function containsErodedMacroPosition(field: SerializedErodedMacroField, x: number, z: number): boolean {
  const maxX = field.originX + (field.width - 1) * field.cellSizeM;
  const maxZ = field.originZ + (field.height - 1) * field.cellSizeM;
  return x >= field.originX && x <= maxX && z >= field.originZ && z <= maxZ;
}

export function sampleErodedMacroHeight(field: SerializedErodedMacroField, x: number, z: number): number {
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
}

export function buildHydrologyGraphFromErodedMacro(
  input: Omit<BuildHydrologyGraphInput, "sampleHeight">,
  field: SerializedErodedMacroField,
  artifactRef: ErosionArtifactRef,
): HydrologyGraph {
  const spacingM = input.config?.spacingM ?? field.cellSizeM;
  const expectedWidth = Math.floor(input.sizeM.x / spacingM) + 1;
  const expectedHeight = Math.floor(input.sizeM.z / spacingM) + 1;
  const origin = input.originM ?? { x: 0, z: 0 };
  const count = field.width * field.height;
  if (field.cellSizeM !== spacingM) throw new Error("hydrology spacing must exactly match erosion cell size");
  if (field.width !== expectedWidth || field.height !== expectedHeight) throw new Error("hydrology bounds must exactly match erosion dimensions");
  if (field.originX !== origin.x || field.originZ !== origin.z) throw new Error("hydrology origin must exactly match erosion origin");
  if (field.heightFixed.length !== count || field.hardness.length !== count
    || field.sediment.length !== count || field.deposition.length !== count) {
    throw new Error("erosion macro arrays do not match their dimensions");
  }
  const originalHeight = new Float32Array(count);
  for (let index = 0; index < count; index++) originalHeight[index] = field.heightFixed[index]! / HEIGHT_UNITS_PER_METER;
  const checkpoint: HydrologyMacroSampleCheckpoint = {
    resX: field.width,
    resZ: field.height,
    sizeM: Object.freeze({ ...input.sizeM }),
    originM: Object.freeze({ x: field.originX, z: field.originZ }),
    spacingM,
    originalHeight,
    nextRow: field.height,
  };
  const graph = buildHydrologyGraphFromMacro(input, checkpoint);
  return Object.freeze({
    ...graph,
    macro: Object.freeze({
      ...graph.macro,
      erosion: Object.freeze({ ...field, artifactRef }),
    }),
  });
}
