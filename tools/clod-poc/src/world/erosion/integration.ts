import { sha256Hex } from "../../cache/checksum.js";
import { HARDNESS_MAX, SEDIMENT_UNITS_PER_METER } from "./constants.js";
import type { ErodedMacroField, ErosionArtifactRef, ErosionMaterialChannels, SerializedErodedMacroField } from "./types.js";

let activeField: ErodedMacroField | null = null;
let latestArtifactRef: ErosionArtifactRef | null = null;
let latestArtifactWorldId: string | null = null;

export function setActiveErodedMacroField(field: ErodedMacroField | null): void {
  activeField = field;
}

export function getActiveErodedMacroField(): ErodedMacroField | null {
  return activeField;
}

export function setLatestErosionArtifactRef(ref: ErosionArtifactRef | null, worldId: string | null = null): void {
  latestArtifactRef = ref;
  latestArtifactWorldId = ref ? worldId : null;
}

export function getLatestErosionArtifactRef(worldId?: string): ErosionArtifactRef | null {
  return worldId === undefined || latestArtifactWorldId === worldId ? latestArtifactRef : null;
}

export function serializeErodedMacroField(field: ErodedMacroField): SerializedErodedMacroField {
  return {
    width: field.width,
    height: field.height,
    cellSizeM: field.cellSizeM,
    originX: field.originX,
    originZ: field.originZ,
    heightFixed: field.heightFixed,
    hardness: field.hardness,
    sediment: field.sediment,
    deposition: field.deposition,
  };
}

export function toErodedMacroField(serialized: SerializedErodedMacroField): ErodedMacroField {
  const field: ErodedMacroField = {
    ...serialized,
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
      return (a + (b - a) * tz) / 256;
    },
  };
  return Object.freeze(field);
}

export function cloneSerializedErodedMacroField(field: ErodedMacroField): SerializedErodedMacroField {
  return {
    width: field.width,
    height: field.height,
    cellSizeM: field.cellSizeM,
    originX: field.originX,
    originZ: field.originZ,
    heightFixed: new Int32Array(field.heightFixed),
    hardness: new Uint16Array(field.hardness),
    sediment: new Uint32Array(field.sediment),
    deposition: new Int32Array(field.deposition),
  };
}

export function collectSerializedErosionTransferables(field: SerializedErodedMacroField): Transferable[] {
  return [field.heightFixed.buffer, field.hardness.buffer, field.sediment.buffer, field.deposition.buffer];
}

export function sampleErosionMaterialChannels(field: ErodedMacroField, x: number, z: number): ErosionMaterialChannels {
  const gx = Math.max(0, Math.min(field.width - 1, Math.round((x - field.originX) / field.cellSizeM)));
  const gz = Math.max(0, Math.min(field.height - 1, Math.round((z - field.originZ) / field.cellSizeM)));
  const index = gz * field.width + gx;
  const sedimentDepthM = field.sediment[index]! / SEDIMENT_UNITS_PER_METER;
  const netDepositionM = field.deposition[index]! / SEDIMENT_UNITS_PER_METER;
  const hardness01 = field.hardness[index]! / HARDNESS_MAX;
  const wetnessSeed = Math.min(1, Math.max(0, sedimentDepthM * 4 + Math.max(0, netDepositionM) * 2 + (1 - hardness01) * 0.15));
  return { sedimentDepthM, netDepositionM, hardness01, wetnessSeed };
}

export function sampleActiveErosionMaterialChannels(x: number, z: number): ErosionMaterialChannels | null {
  return activeField ? sampleErosionMaterialChannels(activeField, x, z) : null;
}

const encoder = new TextEncoder();

export async function computeErosionSourceTerrainHash(input: {
  readonly generatorVersion: string;
  readonly worldId: string;
  readonly seed: number;
  readonly sizeM: { readonly x: number; readonly z: number };
  readonly originM: { readonly x: number; readonly z: number };
  readonly terrainFieldConfig: unknown;
}): Promise<string> {
  return sha256Hex(encoder.encode(JSON.stringify({
    generatorVersion: input.generatorVersion,
    worldId: input.worldId,
    seed: input.seed,
    sizeM: input.sizeM,
    originM: input.originM,
    terrainFieldConfig: input.terrainFieldConfig,
  })).buffer);
}
