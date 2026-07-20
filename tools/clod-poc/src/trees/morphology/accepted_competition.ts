import type { TreeCompetitionSample, TreeIdentity } from "./types.js";

const COMPETITION_CELL_SIZE_M = 32;
const INNER_RADIUS_M = 8;
const MID_RADIUS_M = 16;
const PRESSURE_NORMALIZATION = 8;

export interface AcceptedTreeCompetitionRecord {
  readonly identity: TreeIdentity;
  readonly positionXZ: readonly [number, number];
  readonly crownRadiusM: number;
}

export interface AcceptedTreeCompetitionSampler {
  sample(identity: TreeIdentity): TreeCompetitionSample;
}

interface IndexedRecord extends AcceptedTreeCompetitionRecord {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

export function createAcceptedTreeCompetitionSampler(
  records: readonly AcceptedTreeCompetitionRecord[],
): AcceptedTreeCompetitionSampler {
  const sorted = records.map(normalizeRecord).sort(compareRecordIdentity);
  const byIdentity = new Map<string, IndexedRecord>();
  const buckets = new Map<string, IndexedRecord[]>();

  for (const record of sorted) {
    const identityKey = treeIdentityKey(record.identity);
    if (byIdentity.has(identityKey)) {
      throw new Error(`duplicate accepted tree identity: ${identityKey}`);
    }
    byIdentity.set(identityKey, record);
    const bucketKey = competitionBucketKey(record.x, record.z);
    const bucket = buckets.get(bucketKey);
    if (bucket) bucket.push(record);
    else buckets.set(bucketKey, [record]);
  }

  return {
    sample(identity) {
      const target = byIdentity.get(treeIdentityKey(identity));
      if (!target) return emptyTreeCompetitionSample();
      return sampleIndexedCompetition(target, buckets);
    },
  };
}

export function emptyTreeCompetitionSample(): TreeCompetitionSample {
  return {
    crownPressure: 0,
    directionalPressure: 0,
    openLightDirectionXZ: [1, 0],
  };
}

function sampleIndexedCompetition(
  target: IndexedRecord,
  buckets: ReadonlyMap<string, readonly IndexedRecord[]>,
): TreeCompetitionSample {
  const centerX = Math.floor(target.x / COMPETITION_CELL_SIZE_M);
  const centerZ = Math.floor(target.z / COMPETITION_CELL_SIZE_M);
  let totalPressure = 0;
  let pressureX = 0;
  let pressureZ = 0;

  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const bucket = buckets.get(`${centerX + dx},${centerZ + dz}`);
      if (!bucket) continue;
      for (const neighbor of bucket) {
        if (sameIdentity(target.identity, neighbor.identity)) continue;
        const offsetX = neighbor.x - target.x;
        const offsetZ = neighbor.z - target.z;
        const distance = Math.hypot(offsetX, offsetZ);
        if (distance <= 1e-6 || distance > COMPETITION_CELL_SIZE_M) continue;

        const influence = competitionInfluence(target.radius, neighbor.radius, distance);
        if (influence <= 0) continue;
        totalPressure += influence;
        pressureX += offsetX / distance * influence;
        pressureZ += offsetZ / distance * influence;
      }
    }
  }

  const directionalMagnitude = Math.hypot(pressureX, pressureZ);
  return {
    crownPressure: clamp01(totalPressure / PRESSURE_NORMALIZATION),
    directionalPressure: clamp01(directionalMagnitude / PRESSURE_NORMALIZATION),
    openLightDirectionXZ: directionalMagnitude > 1e-9
      ? [-pressureX / directionalMagnitude, -pressureZ / directionalMagnitude]
      : [1, 0],
  };
}

function competitionInfluence(targetRadius: number, neighborRadius: number, distance: number): number {
  const crownContactM = Math.max(1, targetRadius + neighborRadius);
  const outerM = Math.max(COMPETITION_CELL_SIZE_M, crownContactM + 0.001);
  const crownOverlap = 1 - smoothstep(crownContactM, outerM, distance);
  const radialWeight = distance <= INNER_RADIUS_M
    ? 1
    : distance <= MID_RADIUS_M
      ? 2 / 3
      : 1 / 3;
  return clamp01(crownOverlap) * radialWeight;
}

function normalizeRecord(record: AcceptedTreeCompetitionRecord): IndexedRecord {
  const x = finiteOrZero(record.positionXZ[0]);
  const z = finiteOrZero(record.positionXZ[1]);
  return {
    ...record,
    positionXZ: [x, z],
    x,
    z,
    radius: Math.max(0, finiteOrZero(record.crownRadiusM)),
  };
}

function compareRecordIdentity(a: IndexedRecord, b: IndexedRecord): number {
  const highDelta = (a.identity.stableIdHi >>> 0) - (b.identity.stableIdHi >>> 0);
  return highDelta || (a.identity.stableIdLo >>> 0) - (b.identity.stableIdLo >>> 0);
}

function competitionBucketKey(x: number, z: number): string {
  return `${Math.floor(x / COMPETITION_CELL_SIZE_M)},${Math.floor(z / COMPETITION_CELL_SIZE_M)}`;
}

function treeIdentityKey(identity: TreeIdentity): string {
  return `${identity.stableIdHi >>> 0}:${identity.stableIdLo >>> 0}`;
}

function sameIdentity(a: TreeIdentity, b: TreeIdentity): boolean {
  return (a.stableIdLo >>> 0) === (b.stableIdLo >>> 0)
    && (a.stableIdHi >>> 0) === (b.stableIdHi >>> 0);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
