import customPropsConfigText from "../../../config/custom_props.yaml?raw";
import { defaultConstructionConfig } from "../../construction/config.js";
import type { PlacedConstructionPiece } from "../../construction/types.js";
import { projectPropEditStore } from "../../project/prop_edit_store.js";
import type { ProjectPropInstance } from "../../project/project_props.js";
import { parseCustomPropsConfig } from "../../props/prop_config.js";
import type { CustomPropsSettings, PropAssetDef, PropCategory } from "../../props/prop_types.js";
import { savedPropStore } from "../../save/prop_store.js";
import type { SavedPropInstance } from "../../save/save_schema.js";
import {
  getVoxelOverlaySource,
  type VoxelOverlaySource,
  type VoxelVolumeStamp,
} from "../../terrain/voxel_overlay/voxel_overlay.js";
import {
  HEIGHTFIELD_TILE_RES,
  HEIGHTFIELD_TILE_SAMPLE_SPACING_M,
} from "../../world/heightfield_tiles/heightfield_tile.js";
import {
  tileOriginM,
  WORLD_TILE_SIZE_M,
  type WorldTileKey,
} from "../../world/tile_key.js";

export const VEGETATION_AUTHORITY_EXCLUDED_HEIGHT_M = -1_000_000;

const CUSTOM_PROPS = parseCustomPropsConfig(customPropsConfigText);
const PROP_RADIUS_BY_CATEGORY: Readonly<Record<PropCategory, number>> = Object.freeze({
  small_decor: 0.75,
  medium_static: 2,
  large_static: 5,
  vegetation: 2,
  interactive: 1.5,
});
const UNKNOWN_PROP_RADIUS_M = 1.5;
const EXCLUSION_MARGIN_M = 0.35;

type ExclusionSource = "voxel" | "project_prop" | "construction" | "destroyed_prop";

interface CircleFootprint {
  readonly kind: "circle";
  readonly x: number;
  readonly z: number;
  readonly radiusM: number;
  readonly source: ExclusionSource;
}

interface CapsuleFootprint {
  readonly kind: "capsule";
  readonly startX: number;
  readonly startZ: number;
  readonly endX: number;
  readonly endZ: number;
  readonly radiusM: number;
  readonly source: ExclusionSource;
}

type ExclusionFootprint = CircleFootprint | CapsuleFootprint;

export interface VegetationAuthorityHeightfieldMaskStats {
  readonly revision: number;
  readonly footprints: number;
  readonly voxelFootprints: number;
  readonly projectPropFootprints: number;
  readonly constructionFootprints: number;
  readonly destroyedPropFootprints: number;
  readonly indexedTiles: number;
}

interface MaskState {
  revision: number;
  voxelSource: VoxelOverlaySource | null;
  projectPropRevision: number;
  savedPropRevision: number;
  constructionSnapshot: string;
  byTile: ReadonlyMap<string, readonly ExclusionFootprint[]>;
  stats: VegetationAuthorityHeightfieldMaskStats;
}

const state: MaskState = {
  revision: 0,
  voxelSource: null,
  projectPropRevision: -1,
  savedPropRevision: -1,
  constructionSnapshot: "",
  byTile: new Map(),
  stats: Object.freeze({
    revision: 0,
    footprints: 0,
    voxelFootprints: 0,
    projectPropFootprints: 0,
    constructionFootprints: 0,
    destroyedPropFootprints: 0,
    indexedTiles: 0,
  }),
};

let constructionReadWarningLogged = false;
let constructionParseWarningLogged = false;

export function refreshVegetationAuthorityHeightfieldMask(): boolean {
  const voxelSource = getVoxelOverlaySource();
  const projectPropRevision = projectPropEditStore.revision();
  const savedPropRevision = savedPropStore.revision();
  const constructionSnapshot = readConstructionSnapshot();
  if (
    state.revision > 0
    && state.voxelSource === voxelSource
    && state.projectPropRevision === projectPropRevision
    && state.savedPropRevision === savedPropRevision
    && state.constructionSnapshot === constructionSnapshot
  ) {
    return false;
  }

  const voxel = voxelFootprints(voxelSource);
  const projectProps = projectPropFootprints(CUSTOM_PROPS, projectPropEditStore.snapshot(), "project_prop");
  const destroyedProps = destroyedPropFootprints(CUSTOM_PROPS, savedPropStore.snapshot());
  const construction = constructionFootprints(constructionSnapshot);
  const footprints = Object.freeze([...voxel, ...projectProps, ...construction, ...destroyedProps]);
  const byTile = indexFootprintsByTile(footprints);

  state.revision++;
  state.voxelSource = voxelSource;
  state.projectPropRevision = projectPropRevision;
  state.savedPropRevision = savedPropRevision;
  state.constructionSnapshot = constructionSnapshot;
  state.byTile = byTile;
  state.stats = Object.freeze({
    revision: state.revision,
    footprints: footprints.length,
    voxelFootprints: voxel.length,
    projectPropFootprints: projectProps.length,
    constructionFootprints: construction.length,
    destroyedPropFootprints: destroyedProps.length,
    indexedTiles: byTile.size,
  });
  return true;
}

export function vegetationAuthorityHeightfieldMaskRevision(): number {
  return state.revision;
}

export function vegetationAuthorityHeightfieldMaskStats(): VegetationAuthorityHeightfieldMaskStats {
  return state.stats;
}

export function maskVegetationAuthorityHeightfieldTile(
  key: WorldTileKey,
  heights: Float32Array,
): Float32Array {
  const footprints = state.byTile.get(tileKey(key));
  if (!footprints?.length) return heights;
  if (heights.length !== HEIGHTFIELD_TILE_RES * HEIGHTFIELD_TILE_RES) {
    throw new Error(`vegetation authority heightfield tile has ${heights.length} samples; expected ${HEIGHTFIELD_TILE_RES * HEIGHTFIELD_TILE_RES}`);
  }

  const masked = heights.slice();
  const origin = tileOriginM(key);
  for (const footprint of footprints) {
    rasterFootprint(masked, origin.x, origin.z, footprint);
  }
  return masked;
}

export function voxelFootprints(source: VoxelOverlaySource): readonly ExclusionFootprint[] {
  const footprints: ExclusionFootprint[] = [];
  for (const region of source.regions) {
    for (const entrance of region.caveEntrances) {
      footprints.push(circle(entrance.position[0], entrance.position[2], entrance.farMaskRadiusM, "voxel"));
    }
    if (region.caveSystem && !region.caveSystem.authored) {
      for (let index = 0; index < region.caveEntrances.length; index++) {
        const entrance = region.caveEntrances[index]!;
        const facingLength = Math.hypot(...entrance.facing) || 1;
        const fx = entrance.facing[0] / facingLength;
        const fz = entrance.facing[2] / facingLength;
        const length = 22 + seededUnit(region.caveSystem.proceduralSeed, index * 2 + 1) * 10;
        const radius = 3.25 + seededUnit(region.caveSystem.proceduralSeed, index * 2 + 2) * 1.25;
        const startX = entrance.position[0] - fx * 2;
        const startZ = entrance.position[2] - fz * 2;
        const endX = entrance.position[0] + fx * length;
        const endZ = entrance.position[2] + fz * length;
        footprints.push(capsule(startX, startZ, endX, endZ, radius, "voxel"));
        footprints.push(circle(endX, endZ, radius * 2.2, "voxel"));
      }
    }
    for (const stamp of region.stamps) {
      const footprint = carveStampFootprint(stamp);
      if (footprint) footprints.push(footprint);
    }
  }
  return Object.freeze(footprints);
}

export function projectPropFootprints(
  config: CustomPropsSettings,
  props: readonly ProjectPropInstance[],
  source: Extract<ExclusionSource, "project_prop" | "destroyed_prop"> = "project_prop",
): readonly ExclusionFootprint[] {
  const assets = new Map(config.props.map((asset) => [asset.id, asset] as const));
  return Object.freeze(props.map((prop) => propFootprint(prop, assets.get(prop.prefabId), source)));
}

export function constructionFootprints(snapshot: string): readonly ExclusionFootprint[] {
  const placed = parseConstructionSnapshot(snapshot);
  const pieces = new Map(defaultConstructionConfig.pieces.map((piece) => [piece.id, piece] as const));
  const footprints: ExclusionFootprint[] = [];
  for (const entry of placed) {
    const piece = pieces.get(entry.typeId);
    if (!piece) continue;
    const radiusM = Math.hypot(piece.dimensionsM[0] * 0.5, piece.dimensionsM[2] * 0.5)
      + defaultConstructionConfig.placement.overlapPaddingM
      + EXCLUSION_MARGIN_M;
    footprints.push(circle(entry.position[0], entry.position[2], radiusM, "construction"));
  }
  return Object.freeze(footprints);
}

function destroyedPropFootprints(
  config: CustomPropsSettings,
  props: readonly SavedPropInstance[],
): readonly ExclusionFootprint[] {
  const destroyed = props
    .filter((prop) => prop.state !== "active" && prop.environmental !== undefined)
    .map((prop): ProjectPropInstance => ({
      id: prop.id,
      prefabId: prop.prefabId,
      position: [prop.position[0], prop.position[1], prop.position[2]],
      rotation: [prop.rotation[0], prop.rotation[1], prop.rotation[2], prop.rotation[3]],
      scale: [prop.scale[0], prop.scale[1], prop.scale[2]],
      anchor: prop.anchor,
      seed: prop.seed,
      variationId: prop.variationId,
      flags: prop.flags,
      revision: prop.revision,
    }));
  return projectPropFootprints(config, destroyed, "destroyed_prop");
}

function propFootprint(
  prop: ProjectPropInstance,
  asset: PropAssetDef | undefined,
  source: Extract<ExclusionSource, "project_prop" | "destroyed_prop">,
): ExclusionFootprint {
  const scale = Math.max(1, Math.abs(prop.scale[0]), Math.abs(prop.scale[2]));
  const flattenRadius = asset?.placement.flattenRadius;
  const baseRadius = flattenRadius !== undefined && flattenRadius > 0
    ? flattenRadius
    : asset ? PROP_RADIUS_BY_CATEGORY[asset.category] : UNKNOWN_PROP_RADIUS_M;
  return circle(prop.position[0], prop.position[2], baseRadius * scale + EXCLUSION_MARGIN_M, source);
}

function carveStampFootprint(stamp: VoxelVolumeStamp): ExclusionFootprint | null {
  if (stamp.operation !== "carve") return null;
  if (stamp.shape === "capsule") {
    const end = stamp.end ?? stamp.start;
    return capsule(stamp.start[0], stamp.start[2], end[0], end[2], stamp.radiusM, "voxel");
  }
  return circle(stamp.start[0], stamp.start[2], stamp.radiusM, "voxel");
}

function indexFootprintsByTile(
  footprints: readonly ExclusionFootprint[],
): ReadonlyMap<string, readonly ExclusionFootprint[]> {
  const mutable = new Map<string, ExclusionFootprint[]>();
  for (const footprint of footprints) {
    const bounds = footprintBounds(footprint);
    const minTileX = Math.floor(bounds.minX / WORLD_TILE_SIZE_M);
    const maxTileX = Math.floor(bounds.maxX / WORLD_TILE_SIZE_M);
    const minTileZ = Math.floor(bounds.minZ / WORLD_TILE_SIZE_M);
    const maxTileZ = Math.floor(bounds.maxZ / WORLD_TILE_SIZE_M);
    for (let tileZ = minTileZ; tileZ <= maxTileZ; tileZ++) {
      for (let tileX = minTileX; tileX <= maxTileX; tileX++) {
        const key = tileKey({ x: tileX, z: tileZ });
        const entries = mutable.get(key) ?? [];
        entries.push(footprint);
        mutable.set(key, entries);
      }
    }
  }
  return new Map([...mutable].map(([key, entries]) => [key, Object.freeze(entries)] as const));
}

function rasterFootprint(
  heights: Float32Array,
  tileOriginX: number,
  tileOriginZ: number,
  footprint: ExclusionFootprint,
): void {
  const bounds = footprintBounds(footprint);
  const minX = clampSampleIndex(Math.floor((bounds.minX - tileOriginX) / HEIGHTFIELD_TILE_SAMPLE_SPACING_M));
  const maxX = clampSampleIndex(Math.ceil((bounds.maxX - tileOriginX) / HEIGHTFIELD_TILE_SAMPLE_SPACING_M));
  const minZ = clampSampleIndex(Math.floor((bounds.minZ - tileOriginZ) / HEIGHTFIELD_TILE_SAMPLE_SPACING_M));
  const maxZ = clampSampleIndex(Math.ceil((bounds.maxZ - tileOriginZ) / HEIGHTFIELD_TILE_SAMPLE_SPACING_M));
  for (let z = minZ; z <= maxZ; z++) {
    const worldZ = tileOriginZ + z * HEIGHTFIELD_TILE_SAMPLE_SPACING_M;
    for (let x = minX; x <= maxX; x++) {
      const worldX = tileOriginX + x * HEIGHTFIELD_TILE_SAMPLE_SPACING_M;
      if (footprintContains(footprint, worldX, worldZ)) {
        heights[z * HEIGHTFIELD_TILE_RES + x] = VEGETATION_AUTHORITY_EXCLUDED_HEIGHT_M;
      }
    }
  }
}

function footprintContains(footprint: ExclusionFootprint, x: number, z: number): boolean {
  if (footprint.kind === "circle") {
    return Math.hypot(x - footprint.x, z - footprint.z) <= footprint.radiusM;
  }
  return distanceToSegment2d(
    x,
    z,
    footprint.startX,
    footprint.startZ,
    footprint.endX,
    footprint.endZ,
  ) <= footprint.radiusM;
}

function footprintBounds(footprint: ExclusionFootprint): {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
} {
  if (footprint.kind === "circle") {
    return {
      minX: footprint.x - footprint.radiusM,
      minZ: footprint.z - footprint.radiusM,
      maxX: footprint.x + footprint.radiusM,
      maxZ: footprint.z + footprint.radiusM,
    };
  }
  return {
    minX: Math.min(footprint.startX, footprint.endX) - footprint.radiusM,
    minZ: Math.min(footprint.startZ, footprint.endZ) - footprint.radiusM,
    maxX: Math.max(footprint.startX, footprint.endX) + footprint.radiusM,
    maxZ: Math.max(footprint.startZ, footprint.endZ) + footprint.radiusM,
  };
}

function circle(x: number, z: number, radiusM: number, source: ExclusionSource): CircleFootprint {
  return Object.freeze({
    kind: "circle",
    x,
    z,
    radiusM: Math.max(0, radiusM),
    source,
  });
}

function capsule(
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
  radiusM: number,
  source: ExclusionSource,
): CapsuleFootprint {
  return Object.freeze({
    kind: "capsule",
    startX,
    startZ,
    endX,
    endZ,
    radiusM: Math.max(0, radiusM),
    source,
  });
}

function distanceToSegment2d(
  x: number,
  z: number,
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
): number {
  const dx = endX - startX;
  const dz = endZ - startZ;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq > 0
    ? Math.max(0, Math.min(1, ((x - startX) * dx + (z - startZ) * dz) / lengthSq))
    : 0;
  return Math.hypot(x - (startX + dx * t), z - (startZ + dz * t));
}

function clampSampleIndex(value: number): number {
  return Math.max(0, Math.min(HEIGHTFIELD_TILE_RES - 1, value));
}

function tileKey(key: WorldTileKey): string {
  return `${key.x},${key.z}`;
}

function seededUnit(seed: number, salt: number): number {
  let value = (seed ^ Math.imul(salt, 0x9e3779b1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d) >>> 0;
  value ^= value >>> 15;
  return value / 0xffff_ffff;
}

function readConstructionSnapshot(): string {
  try {
    return typeof localStorage === "undefined"
      ? ""
      : localStorage.getItem(defaultConstructionConfig.placement.storageKey) ?? "";
  } catch (error) {
    if (!constructionReadWarningLogged) {
      constructionReadWarningLogged = true;
      console.warn("[vegetation-authority] failed to read construction exclusions", error);
    }
    return "";
  }
}

function parseConstructionSnapshot(snapshot: string): readonly PlacedConstructionPiece[] {
  if (!snapshot) return [];
  try {
    const parsed = JSON.parse(snapshot) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPlacedConstructionPiece);
  } catch (error) {
    if (!constructionParseWarningLogged) {
      constructionParseWarningLogged = true;
      console.warn("[vegetation-authority] failed to parse construction exclusions", error);
    }
    return [];
  }
}

function isPlacedConstructionPiece(value: unknown): value is PlacedConstructionPiece {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const position = record.position;
  return typeof record.id === "string"
    && typeof record.typeId === "string"
    && Array.isArray(position)
    && position.length === 3
    && position.every((entry) => typeof entry === "number" && Number.isFinite(entry));
}
