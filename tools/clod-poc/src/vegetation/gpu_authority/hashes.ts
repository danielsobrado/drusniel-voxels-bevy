import { VEGETATION_CHANNEL, type VegetationCategory } from "./constants.js";

export interface VegetationHashInput {
  readonly worldSeed: number;
  readonly category: VegetationCategory;
  readonly schemaVersion: number;
  readonly globalCellX: number;
  readonly globalCellZ: number;
}

export interface VegetationIdentityInput extends VegetationHashInput {
  readonly classId: number;
}

export function treePcg2dU32(cellX: number, cellZ: number, salt: number): [number, number] {
  const m = 1664525;
  const c = 1013904223;
  const saltU32 = salt >>> 0;
  const a0 = (Math.trunc(cellX) + 40000 + (saltU32 & 0x3fff)) >>> 0;
  const b0 = (Math.trunc(cellZ) + 40000 + ((saltU32 >>> 14) & 0x3fff)) >>> 0;
  const a1 = (Math.imul(a0, m) + c) >>> 0;
  const b1 = (Math.imul(b0, m) + c) >>> 0;
  const a2 = (a1 + Math.imul(b1, m)) >>> 0;
  const b2 = (b1 + Math.imul(a2, m)) >>> 0;
  const a3 = (a2 ^ (a2 >>> 16)) >>> 0;
  const b3 = (b2 ^ (b2 >>> 16)) >>> 0;
  const a4 = (a3 + Math.imul(b3, m)) >>> 0;
  const b4 = (b3 + Math.imul(a4, m)) >>> 0;
  return [(a4 ^ (a4 >>> 16)) >>> 0, (b4 ^ (b4 >>> 16)) >>> 0];
}

export function treePcg2d01(cellX: number, cellZ: number, salt: number): [number, number] {
  const [lo, hi] = treePcg2dU32(cellX, cellZ, salt);
  const inverse24BitRange = 1 / 16777216;
  return [(lo & 0xffffff) * inverse24BitRange, (hi & 0xffffff) * inverse24BitRange];
}

export function vegetationValueHash(input: VegetationHashInput, channel: number): [number, number] {
  const worldSeed = input.worldSeed >>> 0;
  const seedHash = treePcg2dU32(
    worldSeed | 0,
    (rotateLeft32(worldSeed, 16) ^ (input.schemaVersion >>> 0)) | 0,
    (VEGETATION_CHANNEL.DOMAIN ^ input.category) >>> 0,
  );
  const domainSalt = (seedHash[0] ^ seedHash[1]) >>> 0;
  const cellHash = treePcg2dU32(input.globalCellX, input.globalCellZ, domainSalt);
  return treePcg2dU32(
    cellHash[0] | 0,
    cellHash[1] | 0,
    ((channel >>> 0) ^ seedHash[1]) >>> 0,
  );
}

export function vegetationStableIdentity(input: VegetationIdentityInput): [number, number] {
  const identityChannel = (
    VEGETATION_CHANNEL.IDENTITY
    ^ Math.imul(input.classId >>> 0, 0x9e3779b9)
  ) >>> 0;
  return vegetationValueHash(input, identityChannel);
}

export function rotateLeft32(value: number, bits: number): number {
  const shift = bits & 31;
  const word = value >>> 0;
  return ((word << shift) | (word >>> ((32 - shift) & 31))) >>> 0;
}
