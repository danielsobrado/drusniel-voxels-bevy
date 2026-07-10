import type * as THREE from "three";
import type { WaterRect, WaterClipmapUpdateStats } from "./waterClipmap.js";

export interface WaterClipmapStatsSource {
  readonly isEnabled: boolean;
  readonly levelCount: number;
  /** Cumulative update-cost counters (partial vs full refills, field samples, ...). */
  readonly updateCostStats?: WaterClipmapUpdateStats;
  getLevelRect(index: number): WaterRect | null;
}

export interface WaterClipmapLevelStats {
  level: number;
  meshName: string;
  cellSize: number | null;
  visible: boolean;
  indexCount: number;
  triangleCount: number;
  rect: WaterRect | null;
}

export interface WaterClipmapRuntimeStats {
  enabled: boolean;
  levelCount: number;
  visibleLevelCount: number;
  indexCount: number;
  triangleCount: number;
  updateCost: WaterClipmapUpdateStats | null;
  levels: WaterClipmapLevelStats[];
}

const CLIPMAP_LEVEL_NAME_PREFIX = "water-clipmap-L";

function clipmapLevelMeshName(level: number): string {
  return `${CLIPMAP_LEVEL_NAME_PREFIX}${level}`;
}

function finiteRect(rect: WaterRect | null): WaterRect | null {
  if (!rect) return null;
  const values = [rect.minX, rect.minZ, rect.maxX, rect.maxZ];
  if (!values.every(Number.isFinite)) return null;
  if (rect.minX > rect.maxX || rect.minZ > rect.maxZ) return null;
  return { ...rect };
}

function meshDrawStats(scene: THREE.Scene, meshName: string, rootEnabled: boolean): {
  visible: boolean;
  indexCount: number;
  triangleCount: number;
} {
  const object = scene.getObjectByName(meshName);
  const mesh = object && "geometry" in object ? object as THREE.Mesh<THREE.BufferGeometry> : null;
  if (!mesh) return { visible: false, indexCount: 0, triangleCount: 0 };

  const rawCount = mesh.geometry.drawRange.count;
  const indexCount = Number.isFinite(rawCount) && rawCount > 0 ? Math.floor(rawCount) : 0;
  const visible = rootEnabled && mesh.visible && indexCount > 0;
  return {
    visible,
    indexCount: visible ? indexCount : 0,
    triangleCount: visible ? Math.floor(indexCount / 3) : 0,
  };
}

export function collectWaterClipmapRuntimeStats(
  clipmap: WaterClipmapStatsSource,
  scene: THREE.Scene,
  cellSizes: readonly number[],
): WaterClipmapRuntimeStats {
  const levels: WaterClipmapLevelStats[] = [];
  let visibleLevelCount = 0;
  let indexCount = 0;
  let triangleCount = 0;

  for (let level = 0; level < clipmap.levelCount; level++) {
    const meshName = clipmapLevelMeshName(level);
    const draw = meshDrawStats(scene, meshName, clipmap.isEnabled);
    if (draw.visible) visibleLevelCount += 1;
    indexCount += draw.indexCount;
    triangleCount += draw.triangleCount;
    levels.push({
      level,
      meshName,
      cellSize: cellSizes[level] ?? null,
      visible: draw.visible,
      indexCount: draw.indexCount,
      triangleCount: draw.triangleCount,
      rect: finiteRect(clipmap.getLevelRect(level)),
    });
  }

  return {
    enabled: clipmap.isEnabled,
    levelCount: clipmap.levelCount,
    visibleLevelCount,
    indexCount,
    triangleCount,
    updateCost: clipmap.updateCostStats ? { ...clipmap.updateCostStats } : null,
    levels,
  };
}
