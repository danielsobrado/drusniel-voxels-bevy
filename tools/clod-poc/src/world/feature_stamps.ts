import type { SavedBounds2D, SavedCity, SavedCityDistrict, SavedRoad, WorldMetadataRecord } from "../save/save_schema.js";

export const FEATURE_STAMP_SOURCE_VERSION = "feature-stamps-v1";

export type FeatureTerrainStamp = RoadTerrainStamp | SettlementTerrainStamp;

export interface RoadTerrainStamp {
  readonly kind: "road";
  readonly id: string;
  readonly points: readonly (readonly [number, number, number])[];
  readonly halfWidthM: number;
  readonly featherM: number;
}

export interface SettlementTerrainStamp {
  readonly kind: "settlement";
  readonly id: string;
  readonly center: readonly [number, number, number];
  readonly radiusM: number;
  readonly featherM: number;
}

export interface FeatureStampField {
  readonly stamps: readonly FeatureTerrainStamp[];
  readonly hash: string;
  sampleHeight(x: number, z: number, inputHeight: number): number;
  excludesScatter(x: number, z: number): boolean;
  sampleStructureCoverage(x: number, z: number, cellSizeM?: number): number;
}

function hashText(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
function smoothstep01(value: number): number { const t = clamp01(value); return t * t * (3 - 2 * t); }

function pointSegment(
  x: number, z: number,
  a: readonly [number, number, number], b: readonly [number, number, number],
): { distance: number; height: number } {
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq > 0 ? clamp01(((x - a[0]) * dx + (z - a[2]) * dz) / lengthSq) : 0;
  return { distance: Math.hypot(x - (a[0] + dx * t), z - (a[2] + dz * t)), height: a[1] + (b[1] - a[1]) * t };
}

function roadSample(stamp: RoadTerrainStamp, x: number, z: number): { distance: number; height: number } {
  let closest = { distance: Number.POSITIVE_INFINITY, height: 0 };
  if (stamp.points.length === 1) return pointSegment(x, z, stamp.points[0]!, stamp.points[0]!);
  for (let index = 1; index < stamp.points.length; index++) {
    const sample = pointSegment(x, z, stamp.points[index - 1]!, stamp.points[index]!);
    if (sample.distance < closest.distance) closest = sample;
  }
  return closest;
}

function cityStamp(city: SavedCity): SettlementTerrainStamp {
  return { kind: "settlement", id: `city:${city.id}`, center: city.center, radiusM: city.radiusM, featherM: 4 };
}

function districtStamp(district: SavedCityDistrict, cities: ReadonlyMap<string, SavedCity>): SettlementTerrainStamp {
  const bounds: SavedBounds2D = district.bounds;
  const centerX = (bounds.minX + bounds.maxX) * 0.5;
  const centerZ = (bounds.minZ + bounds.maxZ) * 0.5;
  const height = cities.get(district.cityId)?.center[1] ?? 0;
  return {
    kind: "settlement", id: `district:${district.id}`, center: [centerX, height, centerZ],
    radiusM: Math.hypot(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) * 0.5, featherM: 2,
  };
}

function roadStamp(road: SavedRoad): RoadTerrainStamp {
  return { kind: "road", id: `road:${road.id}`, points: road.points, halfWidthM: road.widthM * 0.5, featherM: Math.max(1, road.widthM * 0.5) };
}

export function compileFeatureStamps(metadata: WorldMetadataRecord): FeatureStampField {
  const cities = new Map(metadata.cities.map((city) => [city.id, city]));
  const stamps: FeatureTerrainStamp[] = [
    ...metadata.roads.map(roadStamp),
    ...metadata.cities.map(cityStamp),
    ...metadata.districts.map((district) => districtStamp(district, cities)),
  ].sort((a, b) => a.id.localeCompare(b.id));
  return featureStampFieldFromStamps(stamps);
}

/** Rehydrates the pure field after structured-cloning stamps through the tile worker boundary. */
export function featureStampFieldFromStamps(input: readonly FeatureTerrainStamp[]): FeatureStampField {
  const stamps = [...input].sort((a, b) => a.id.localeCompare(b.id));
  const canonical = JSON.stringify(stamps);
  return {
    stamps,
    hash: hashText(`${FEATURE_STAMP_SOURCE_VERSION}:${canonical}`),
    sampleHeight(x, z, inputHeight) {
      let height = inputHeight;
      for (const stamp of stamps) {
        const sample = stamp.kind === "road"
          ? roadSample(stamp, x, z)
          : { distance: Math.hypot(x - stamp.center[0], z - stamp.center[2]), height: stamp.center[1] };
        const core = stamp.kind === "road" ? stamp.halfWidthM : stamp.radiusM;
        if (sample.distance >= core + stamp.featherM) continue;
        const weight = sample.distance <= core ? 1 : 1 - smoothstep01((sample.distance - core) / stamp.featherM);
        height += (sample.height - height) * weight;
      }
      return height;
    },
    excludesScatter(x, z) {
      return stamps.some((stamp) => stamp.kind === "road"
        ? roadSample(stamp, x, z).distance <= stamp.halfWidthM
        : Math.hypot(x - stamp.center[0], z - stamp.center[2]) <= stamp.radiusM);
    },
    sampleStructureCoverage(x, z, cellSizeM = 1) {
      const radius = Math.max(0, cellSizeM * 0.5);
      return stamps.some((stamp) => stamp.kind === "road"
        ? roadSample(stamp, x, z).distance <= stamp.halfWidthM + radius
        : Math.hypot(x - stamp.center[0], z - stamp.center[2]) <= stamp.radiusM + radius) ? 1 : 0;
    },
  };
}

export function terrainSourceHashWithFeatureStamps(terrainSourceHash: string, stamps: FeatureStampField): string {
  if (!terrainSourceHash) throw new Error("terrainSourceHash is required");
  return hashText(`${terrainSourceHash}:${FEATURE_STAMP_SOURCE_VERSION}:${stamps.hash}`);
}
