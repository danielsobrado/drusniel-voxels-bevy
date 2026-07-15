import {
  rotateLeft32,
  treePcg2dU32,
  vegetationStableIdentity,
  VEGETATION_CATEGORY,
  VEGETATION_CHANNEL,
} from "../../vegetation/gpu_authority/pcg2d.js";
import { dressingClassNumericId, type DressingClassId } from "./class_registry.js";
import { ATTACHMENT_ID_CHANNEL, DRESSING_CATEGORY_ID } from "./constants.js";
import type { DressingStableId } from "./types.js";

export interface TerrainDressingStableIdInput {
  readonly worldSeed: number;
  readonly classId: DressingClassId;
  readonly cellX: number;
  readonly cellZ: number;
  readonly generatorSchemaVersion: number;
}

export interface ParentAttachmentStableIdInput {
  readonly worldSeed: number;
  readonly generatorSchemaVersion: number;
  readonly parentStableId: DressingStableId;
  readonly classId: DressingClassId;
  readonly attachmentSlot: number;
}

export function terrainDressingStableId(input: TerrainDressingStableIdInput): DressingStableId {
  const [lo, hi] = vegetationStableIdentity({
    worldSeed: input.worldSeed,
    category: VEGETATION_CATEGORY.DRESSING,
    schemaVersion: input.generatorSchemaVersion,
    globalCellX: input.cellX,
    globalCellZ: input.cellZ,
    classId: dressingClassNumericId(input.classId),
  });
  return { lo, hi };
}

export const persistentDressingStableId = terrainDressingStableId;

export function parentAttachmentStableId(input: ParentAttachmentStableIdInput): DressingStableId {
  const worldSeed = input.worldSeed >>> 0;
  const seedHash = treePcg2dU32(
    worldSeed | 0,
    (rotateLeft32(worldSeed, 16) ^ (input.generatorSchemaVersion >>> 0)) | 0,
    (VEGETATION_CHANNEL.DOMAIN ^ DRESSING_CATEGORY_ID) >>> 0,
  );
  const parentHash = treePcg2dU32(
    input.parentStableId.lo | 0,
    input.parentStableId.hi | 0,
    (seedHash[0] ^ seedHash[1]) >>> 0,
  );
  const attachmentChannel = (
    ATTACHMENT_ID_CHANNEL
    ^ Math.imul(dressingClassNumericId(input.classId), 0x9e3779b9)
    ^ (input.attachmentSlot >>> 0)
  ) >>> 0;
  const [lo, hi] = treePcg2dU32(
    parentHash[0] | 0,
    parentHash[1] | 0,
    (attachmentChannel ^ seedHash[1]) >>> 0,
  );
  return { lo, hi };
}

export function stableIdKey(id: DressingStableId): string {
  return `${(id.hi >>> 0).toString(16).padStart(8, "0")}${(id.lo >>> 0).toString(16).padStart(8, "0")}`;
}

export function parseStableIdKey(value: string): DressingStableId {
  if (!/^[0-9a-fA-F]{16}$/.test(value)) throw new Error(`invalid dressing stable ID: ${value}`);
  return {
    hi: Number.parseInt(value.slice(0, 8), 16) >>> 0,
    lo: Number.parseInt(value.slice(8), 16) >>> 0,
  };
}
