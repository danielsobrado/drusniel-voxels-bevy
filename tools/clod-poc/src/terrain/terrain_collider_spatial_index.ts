import * as THREE from "three";
import type { TerrainColliderFootprint } from "./terrain_collider.js";

export const COLLIDER_SPATIAL_CELL_SIZE = 64;

const tempRayBox = new THREE.Box3();

export function overlapsFootprint(box: THREE.Box3, footprint: TerrainColliderFootprint): boolean {
  return box.max.x >= footprint.minX
    && box.min.x <= footprint.maxX
    && box.max.z >= footprint.minZ
    && box.min.z <= footprint.maxZ;
}

export function footprintContainsPoint(footprint: TerrainColliderFootprint, x: number, z: number): boolean {
  return x >= footprint.minX && x <= footprint.maxX && z >= footprint.minZ && z <= footprint.maxZ;
}

export function rayCanHitFootprint(ray: THREE.Ray, footprint: TerrainColliderFootprint): boolean {
  tempRayBox.min.set(footprint.minX, -10000, footprint.minZ);
  tempRayBox.max.set(footprint.maxX, 10000, footprint.maxZ);
  return ray.intersectsBox(tempRayBox);
}

export interface TerrainColliderSpatialEntry {
  id: string;
  footprint: TerrainColliderFootprint;
}

export interface TerrainColliderSpatialIndex {
  indexEntry(entry: TerrainColliderSpatialEntry): void;
  unindexEntry(id: string): void;
  rebuild(entries: Iterable<TerrainColliderSpatialEntry>): void;
  entriesForCellKeys<T extends TerrainColliderSpatialEntry>(
    keys: Iterable<string>,
    resolve: (id: string) => T | undefined,
  ): T[];
  entriesForRay<T extends TerrainColliderSpatialEntry>(
    ray: THREE.Ray,
    maxDistance: number,
    resolve: (id: string) => T | undefined,
    allEntries: () => Iterable<T>,
  ): T[];
  entriesForBox<T extends TerrainColliderSpatialEntry>(
    box: THREE.Box3,
    resolve: (id: string) => T | undefined,
  ): T[];
  coversPoint(
    x: number,
    z: number,
    resolve: (id: string) => TerrainColliderSpatialEntry | undefined,
  ): boolean;
  clear(): void;
}

export function createTerrainColliderSpatialIndex(): TerrainColliderSpatialIndex {
  const spatialCells = new Map<string, Set<string>>();
  const entryCells = new Map<string, string[]>();

  const indexEntry = (entry: TerrainColliderSpatialEntry): void => {
    const minX = Math.floor(entry.footprint.minX / COLLIDER_SPATIAL_CELL_SIZE);
    const maxX = Math.floor((entry.footprint.maxX - 1e-6) / COLLIDER_SPATIAL_CELL_SIZE);
    const minZ = Math.floor(entry.footprint.minZ / COLLIDER_SPATIAL_CELL_SIZE);
    const maxZ = Math.floor((entry.footprint.maxZ - 1e-6) / COLLIDER_SPATIAL_CELL_SIZE);
    const keys: string[] = [];
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        const key = `${x},${z}`;
        const ids = spatialCells.get(key) ?? new Set<string>();
        ids.add(entry.id);
        spatialCells.set(key, ids);
        keys.push(key);
      }
    }
    entryCells.set(entry.id, keys);
  };

  const unindexEntry = (id: string): void => {
    for (const key of entryCells.get(id) ?? []) {
      const ids = spatialCells.get(key);
      ids?.delete(id);
      if (ids?.size === 0) spatialCells.delete(key);
    }
    entryCells.delete(id);
  };

  const entriesForCellKeys = <T extends TerrainColliderSpatialEntry>(
    keys: Iterable<string>,
    resolve: (id: string) => T | undefined,
  ): T[] => {
    const ids = new Set<string>();
    for (const key of keys) for (const id of spatialCells.get(key) ?? []) ids.add(id);
    return [...ids].map((id) => resolve(id)).filter((entry): entry is T => entry !== undefined);
  };

  return {
    indexEntry,
    unindexEntry,
    rebuild(entries) {
      spatialCells.clear();
      entryCells.clear();
      for (const entry of entries) indexEntry(entry);
    },
    entriesForCellKeys,
    entriesForRay(ray, maxDistance, resolve, allEntries) {
      if (!Number.isFinite(maxDistance)) return [...allEntries()];
      const horizontalDistance = maxDistance * Math.hypot(ray.direction.x, ray.direction.z);
      const steps = Math.max(1, Math.ceil(horizontalDistance / COLLIDER_SPATIAL_CELL_SIZE));
      const keys = new Set<string>();
      for (let step = 0; step <= steps; step++) {
        const distance = maxDistance * (step / steps);
        const cellX = Math.floor((ray.origin.x + ray.direction.x * distance) / COLLIDER_SPATIAL_CELL_SIZE);
        const cellZ = Math.floor((ray.origin.z + ray.direction.z * distance) / COLLIDER_SPATIAL_CELL_SIZE);
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) keys.add(`${cellX + dx},${cellZ + dz}`);
      }
      return entriesForCellKeys(keys, resolve);
    },
    entriesForBox(box, resolve) {
      const keys: string[] = [];
      const minX = Math.floor(box.min.x / COLLIDER_SPATIAL_CELL_SIZE);
      const maxX = Math.floor(box.max.x / COLLIDER_SPATIAL_CELL_SIZE);
      const minZ = Math.floor(box.min.z / COLLIDER_SPATIAL_CELL_SIZE);
      const maxZ = Math.floor(box.max.z / COLLIDER_SPATIAL_CELL_SIZE);
      for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) keys.push(`${x},${z}`);
      return entriesForCellKeys(keys, resolve);
    },
    coversPoint(x, z, resolve) {
      const key = `${Math.floor(x / COLLIDER_SPATIAL_CELL_SIZE)},${Math.floor(z / COLLIDER_SPATIAL_CELL_SIZE)}`;
      for (const entry of entriesForCellKeys([key], resolve)) {
        if (footprintContainsPoint(entry.footprint, x, z)) return true;
      }
      return false;
    },
    clear() {
      spatialCells.clear();
      entryCells.clear();
    },
  };
}
