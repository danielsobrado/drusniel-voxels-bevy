export const VEGETATION_SCHEMA_VERSION = 1;

export const VEGETATION_CATEGORY = {
  TREE: 1,
  GRASS: 2,
  UNDERSTORY: 3,
  STONE: 4,
  DRESSING: 5,
} as const;

export const VEGETATION_CHANNEL = {
  DOMAIN: 0x1001,
  CLUSTER_ID: 0x1002,
  IDENTITY: 0x1003,
  JITTER: 0x1004,
  CLASS: 0x1005,
  SCALE: 0x1006,
  ROTATION: 0x1007,
  WIND: 0x1008,
  AGE: 0x1009,
  HEALTH: 0x100a,
} as const;

export interface VegetationIdentityInput {
  worldSeed: number;
  category: number;
  schemaVersion: number;
  globalCellX: number;
  globalCellZ: number;
  classId: number;
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
  const inv = 1 / 16777216;
  return [(lo & 0xffffff) * inv, (hi & 0xffffff) * inv];
}

export function vegetationValueHash(
  input: Omit<VegetationIdentityInput, "classId">,
  channel: number,
): [number, number] {
  const worldSeed = input.worldSeed >>> 0;
  const seedHash = treePcg2dU32(
    worldSeed | 0,
    (rotateLeft32(worldSeed, 16) ^ (input.schemaVersion >>> 0)) | 0,
    (VEGETATION_CHANNEL.DOMAIN ^ (input.category >>> 0)) >>> 0,
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
