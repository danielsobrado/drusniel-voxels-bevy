import { VEGETATION_CHANNEL, type VegetationCategory } from "./constants.js";
import { vegetationValueHash } from "./hashes.js";

export interface VegetationClusterCoordinates {
  readonly clusterX: number;
  readonly clusterZ: number;
}

export interface VegetationClusterIdentityInput extends VegetationClusterCoordinates {
  readonly worldSeed: number;
  readonly schemaVersion: number;
  readonly category: VegetationCategory;
}

export interface CandidateCellRange {
  readonly firstCell: number;
  readonly endCellExclusive: number;
  readonly count: number;
}

function positiveFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive finite number`);
  return value;
}

function integerCoordinate(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer`);
  return value;
}

export function clusterCoordinatesForWorld(
  worldX: number,
  worldZ: number,
  clusterSizeM: number,
): VegetationClusterCoordinates {
  const size = positiveFinite(clusterSizeM, "clusterSizeM");
  if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) throw new Error("world coordinates must be finite");
  return {
    clusterX: Math.floor(worldX / size),
    clusterZ: Math.floor(worldZ / size),
  };
}

export function vegetationClusterId(input: VegetationClusterIdentityInput): readonly [number, number] {
  return vegetationValueHash({
    worldSeed: input.worldSeed,
    schemaVersion: input.schemaVersion,
    category: input.category,
    globalCellX: integerCoordinate(input.clusterX, "clusterX"),
    globalCellZ: integerCoordinate(input.clusterZ, "clusterZ"),
  }, VEGETATION_CHANNEL.CLUSTER_ID);
}

export function candidateCellRangeForCluster(
  clusterCoordinate: number,
  clusterSizeM: number,
  spacingM: number,
): CandidateCellRange {
  const coordinate = integerCoordinate(clusterCoordinate, "clusterCoordinate");
  const size = positiveFinite(clusterSizeM, "clusterSizeM");
  const spacing = positiveFinite(spacingM, "spacingM");
  const firstCell = Math.ceil(coordinate * size / spacing);
  const endCellExclusive = Math.ceil((coordinate + 1) * size / spacing);
  return { firstCell, endCellExclusive, count: endCellExclusive - firstCell };
}

export function candidateCountForCluster(
  clusterX: number,
  clusterZ: number,
  clusterSizeM: number,
  spacingM: number,
): number {
  const x = candidateCellRangeForCluster(clusterX, clusterSizeM, spacingM);
  const z = candidateCellRangeForCluster(clusterZ, clusterSizeM, spacingM);
  return x.count * z.count;
}
