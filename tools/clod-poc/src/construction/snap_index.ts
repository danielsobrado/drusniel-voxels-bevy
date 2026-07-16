import type { ConstructionPieceDef, ConstructionSnapConfig, ConstructionSnapResult, IndexedConstructionSnapPoint, SnapGroup } from "./types.js";

const HORIZONTAL_EPSILON = 0.000001;
const SNAP_COMPATIBILITY_SCORE_WEIGHT = 10;
const MAX_RAY_CENTER_CELLS = 100_000;

export interface ConstructionSnapQueryStats {
  visitedCells: number;
  candidatePoints: number;
  traversalTruncated: boolean;
}

function dot(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(value: readonly [number, number, number]): [number, number, number] {
  const len = Math.hypot(value[0], value[1], value[2]);
  if (len <= HORIZONTAL_EPSILON) return [0, 1, 0];
  return [value[0] / len, value[1] / len, value[2] / len];
}

function normalizeHorizontal(value: readonly [number, number, number]): [number, number, number] | null {
  const len = Math.hypot(value[0], value[2]);
  if (len <= HORIZONTAL_EPSILON) return null;
  return [value[0] / len, 0, value[2] / len];
}

function rotateYQuarter(value: readonly [number, number, number], quarterTurns: number): [number, number, number] {
  const turns = ((quarterTurns % 4) + 4) % 4;
  const [x, y, z] = value;
  if (turns === 1) return [z, y, -x];
  if (turns === 2) return [-x, y, -z];
  if (turns === 3) return [-z, y, x];
  return [x, y, z];
}

function add(a: readonly [number, number, number], b: readonly [number, number, number]): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a: readonly [number, number, number], b: readonly [number, number, number]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function distance(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function length(value: readonly [number, number, number]): number {
  return Math.hypot(value[0], value[1], value[2]);
}

function accepts(sourceAccepts: readonly SnapGroup[], sourceGroup: SnapGroup, target: IndexedConstructionSnapPoint): boolean {
  const sourceAllowsTarget = sourceAccepts.length === 0 || sourceAccepts.includes(target.group);
  const targetAllowsSource = target.accepts.length === 0 || target.accepts.includes(sourceGroup);
  return sourceAllowsTarget && targetAllowsSource;
}

function isWallFloorPair(sourceGroup: SnapGroup, targetGroup: SnapGroup): boolean {
  return ((sourceGroup === "wall-bottom" || sourceGroup === "wall-top") && targetGroup === "floor-edge")
    || (sourceGroup === "floor-edge" && (targetGroup === "wall-bottom" || targetGroup === "wall-top"));
}

function isWallStackPair(sourceGroup: SnapGroup, targetGroup: SnapGroup): boolean {
  return (sourceGroup === "wall-bottom" && targetGroup === "wall-top")
    || (sourceGroup === "wall-top" && targetGroup === "wall-bottom");
}

function localHorizontalSnapNormal(piece: ConstructionPieceDef): [number, number, number] {
  return piece.dimensionsM[0] <= piece.dimensionsM[2] ? [1, 0, 0] : [0, 0, 1];
}

function wallFloorAlignment(
  piece: ConstructionPieceDef,
  sourceGroup: SnapGroup,
  targetGroup: SnapGroup,
  rotationQuarterTurns: number,
  sourceDir: readonly [number, number, number],
  targetDir: readonly [number, number, number],
): number | null {
  if (!isWallFloorPair(sourceGroup, targetGroup)) return null;
  if (sourceGroup === "wall-bottom" && targetGroup === "floor-edge") {
    const sourceNormal = normalizeHorizontal(rotateYQuarter(localHorizontalSnapNormal(piece), rotationQuarterTurns));
    const targetNormal = normalizeHorizontal(targetDir);
    return sourceNormal && targetNormal ? Math.abs(dot(sourceNormal, targetNormal)) : 0;
  }
  const sourceNormal = normalizeHorizontal(sourceDir);
  const targetNormal = normalizeHorizontal(targetDir);
  return sourceNormal && targetNormal ? Math.abs(dot(sourceNormal, targetNormal)) : 1;
}

function connectionAlignment(
  piece: ConstructionPieceDef,
  sourceGroup: SnapGroup,
  targetGroup: SnapGroup,
  rotationQuarterTurns: number,
  sourceDir: readonly [number, number, number],
  targetDir: readonly [number, number, number],
): number {
  if (isWallStackPair(sourceGroup, targetGroup)) return -dot(sourceDir, targetDir);
  const floorAlignment = wallFloorAlignment(piece, sourceGroup, targetGroup, rotationQuarterTurns, sourceDir, targetDir);
  if (floorAlignment !== null) return floorAlignment;
  return -dot(sourceDir, targetDir);
}

function compatibilityRank(sourceGroup: SnapGroup, targetGroup: SnapGroup): number {
  if (isWallFloorPair(sourceGroup, targetGroup)) return 4;
  if (isWallStackPair(sourceGroup, targetGroup)) return 4;
  if ((sourceGroup === "roof-edge" && targetGroup === "wall-top") || (sourceGroup === "wall-top" && targetGroup === "roof-edge")) return 4;
  if (sourceGroup === "wall-side" && targetGroup === "wall-side") return 3;
  if (sourceGroup === "floor-edge" && targetGroup === "floor-edge") return 2;
  if (sourceGroup === "generic" && targetGroup === "generic") return 1;
  return 1;
}

function snapWorldPosition(
  target: IndexedConstructionSnapPoint,
  piece: ConstructionPieceDef,
  sourceGroup: SnapGroup,
  sourceOffset: readonly [number, number, number],
): [number, number, number] {
  const worldPosition = sub(target.worldPos, sourceOffset);
  if (sourceGroup === "floor-edge" && target.group === "wall-top") worldPosition[1] += piece.dimensionsM[1];
  return worldPosition;
}

function scoreSnap(alignment: number, distanceScore: number, rank: number, config: ConstructionSnapConfig): number {
  return rank * SNAP_COMPATIBILITY_SCORE_WEIGHT
    + config.alignmentWeight * alignment
    + config.distanceWeight * distanceScore;
}

function axisTraversal(origin: number, direction: number, cell: number, cellSize: number): { step: number; nextT: number; deltaT: number } {
  if (Math.abs(direction) <= HORIZONTAL_EPSILON) {
    return { step: 0, nextT: Number.POSITIVE_INFINITY, deltaT: Number.POSITIVE_INFINITY };
  }
  const step = direction > 0 ? 1 : -1;
  const boundary = (cell + (step > 0 ? 1 : 0)) * cellSize;
  return {
    step,
    nextT: Math.max(0, (boundary - origin) / direction),
    deltaT: cellSize / Math.abs(direction),
  };
}

export class ConstructionSnapIndex {
  private readonly cells = new Map<string, IndexedConstructionSnapPoint[]>();
  private lastQuery: ConstructionSnapQueryStats = { visitedCells: 0, candidatePoints: 0, traversalTruncated: false };

  constructor(private readonly cellSizeM: number) {}

  clear(): void {
    this.cells.clear();
  }

  insert(point: IndexedConstructionSnapPoint): void {
    const key = this.cellKey(point.worldPos);
    const list = this.cells.get(key) ?? [];
    list.push({ ...point, worldDirection: normalize(point.worldDirection) });
    this.cells.set(key, list);
  }

  removeEntity(entityId: string): void {
    for (const [key, points] of this.cells) {
      const retained = points.filter((point) => point.entityId !== entityId);
      if (retained.length > 0) this.cells.set(key, retained);
      else this.cells.delete(key);
    }
  }

  addPiece(piece: ConstructionPieceDef, entityId: string, position: readonly [number, number, number], rotationQuarterTurns: number): void {
    piece.snapPoints.forEach((snap, snapIndex) => {
      this.insert({
        entityId,
        pieceTypeId: piece.id,
        snapIndex,
        worldPos: add(position, rotateYQuarter(snap.localPos, rotationQuarterTurns)),
        worldDirection: rotateYQuarter(snap.direction, rotationQuarterTurns),
        group: snap.group,
        accepts: snap.accepts,
      });
    });
  }

  queryRadius(center: readonly [number, number, number], radiusM: number): IndexedConstructionSnapPoint[] {
    const cellRadius = Math.ceil(radiusM / this.safeCellSize());
    const base = this.toCell(center);
    const result: IndexedConstructionSnapPoint[] = [];
    let visitedCells = 0;
    for (let dz = -cellRadius; dz <= cellRadius; dz += 1) {
      for (let dy = -cellRadius; dy <= cellRadius; dy += 1) {
        for (let dx = -cellRadius; dx <= cellRadius; dx += 1) {
          visitedCells += 1;
          const points = this.cells.get(`${base[0] + dx},${base[1] + dy},${base[2] + dz}`);
          if (!points) continue;
          for (const point of points) {
            if (distance(center, point.worldPos) <= radiusM) result.push(point);
          }
        }
      }
    }
    this.lastQuery = { visitedCells, candidatePoints: result.length, traversalTruncated: false };
    return result;
  }

  findBestSnap(
    cursorWorldPos: readonly [number, number, number],
    piece: ConstructionPieceDef,
    rotationQuarterTurns: number,
    config: ConstructionSnapConfig,
  ): ConstructionSnapResult | null {
    let best: ConstructionSnapResult | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const target of this.queryRadius(cursorWorldPos, config.radiusM)) {
      const candidate = this.findBestSnapAgainstTarget(cursorWorldPos, target, piece, rotationQuarterTurns, config);
      if (!candidate || candidate.score <= bestScore) continue;
      bestScore = candidate.score;
      best = candidate;
    }
    return best;
  }

  findBestSnapNearRay(
    rayOrigin: readonly [number, number, number],
    rayDirection: readonly [number, number, number],
    maxDistanceM: number,
    piece: ConstructionPieceDef,
    rotationQuarterTurns: number,
    config: ConstructionSnapConfig,
  ): ConstructionSnapResult | null {
    const direction = normalize(rayDirection);
    let best: ConstructionSnapResult | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const target of this.queryRayTube(rayOrigin, direction, maxDistanceM, config.radiusM)) {
      const toTarget = sub(target.worldPos, rayOrigin);
      const t = dot(toTarget, direction);
      if (t < 0 || t > maxDistanceM) continue;
      const closest = add(rayOrigin, [direction[0] * t, direction[1] * t, direction[2] * t]);
      const rayDistance = distance(closest, target.worldPos);
      if (rayDistance > config.radiusM) continue;
      const candidate = this.findBestSnapAgainstTarget(closest, target, piece, rotationQuarterTurns, config, rayDistance);
      if (!candidate || candidate.score <= bestScore) continue;
      bestScore = candidate.score;
      best = candidate;
    }
    return best;
  }

  size(): number {
    let total = 0;
    for (const points of this.cells.values()) total += points.length;
    return total;
  }

  queryStats(): ConstructionSnapQueryStats {
    return { ...this.lastQuery };
  }

  private queryRayTube(
    rayOrigin: readonly [number, number, number],
    direction: readonly [number, number, number],
    maxDistanceM: number,
    radiusM: number,
  ): IndexedConstructionSnapPoint[] {
    const cellSize = this.safeCellSize();
    const radiusCells = Math.max(0, Math.ceil(radiusM / cellSize));
    const current = this.toCell(rayOrigin);
    const x = axisTraversal(rayOrigin[0], direction[0], current[0], cellSize);
    const y = axisTraversal(rayOrigin[1], direction[1], current[1], cellSize);
    const z = axisTraversal(rayOrigin[2], direction[2], current[2], cellSize);
    const visited = new Set<string>();
    const candidates = new Map<string, IndexedConstructionSnapPoint>();
    let currentT = 0;
    let centerCells = 0;

    while (currentT <= maxDistanceM && centerCells < MAX_RAY_CENTER_CELLS) {
      centerCells += 1;
      for (let dz = -radiusCells; dz <= radiusCells; dz += 1) {
        for (let dy = -radiusCells; dy <= radiusCells; dy += 1) {
          for (let dx = -radiusCells; dx <= radiusCells; dx += 1) {
            const key = `${current[0] + dx},${current[1] + dy},${current[2] + dz}`;
            if (!visited.add(key)) continue;
            const points = this.cells.get(key);
            if (!points) continue;
            for (const point of points) candidates.set(`${point.entityId}:${point.snapIndex}`, point);
          }
        }
      }

      if (x.nextT <= y.nextT && x.nextT <= z.nextT) {
        if (!Number.isFinite(x.nextT)) break;
        currentT = x.nextT;
        current[0] += x.step;
        x.nextT += x.deltaT;
      } else if (y.nextT <= z.nextT) {
        if (!Number.isFinite(y.nextT)) break;
        currentT = y.nextT;
        current[1] += y.step;
        y.nextT += y.deltaT;
      } else {
        if (!Number.isFinite(z.nextT)) break;
        currentT = z.nextT;
        current[2] += z.step;
        z.nextT += z.deltaT;
      }
    }

    this.lastQuery = {
      visitedCells: visited.size,
      candidatePoints: candidates.size,
      traversalTruncated: centerCells >= MAX_RAY_CENTER_CELLS && currentT <= maxDistanceM,
    };
    return [...candidates.values()];
  }

  private findBestSnapAgainstTarget(
    cursorWorldPos: readonly [number, number, number],
    target: IndexedConstructionSnapPoint,
    piece: ConstructionPieceDef,
    rotationQuarterTurns: number,
    config: ConstructionSnapConfig,
    rayDistanceM = 0,
  ): ConstructionSnapResult | null {
    let best: ConstructionSnapResult | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    piece.snapPoints.forEach((source, sourceSnapIndex) => {
      if (!accepts(source.accepts, source.group, target)) return;
      const sourceDir = normalize(rotateYQuarter(source.direction, rotationQuarterTurns));
      const alignment = connectionAlignment(piece, source.group, target.group, rotationQuarterTurns, sourceDir, target.worldDirection);
      if (alignment < config.minAlignment) return;
      const sourceOffset = rotateYQuarter(source.localPos, rotationQuarterTurns);
      const worldPosition = snapWorldPosition(target, piece, source.group, sourceOffset);
      const cursorDistance = length(sub(cursorWorldPos, worldPosition));
      const distanceScore = 1 - Math.min(1, Math.max(rayDistanceM, cursorDistance) / config.radiusM);
      const rank = compatibilityRank(source.group, target.group);
      const score = scoreSnap(alignment, distanceScore, rank, config);
      if (score <= bestScore) return;
      bestScore = score;
      best = { target, sourceSnapIndex, worldPosition, rotationQuarterTurns, score };
    });
    return best;
  }

  private safeCellSize(): number {
    return Math.max(0.01, this.cellSizeM);
  }

  private toCell(pos: readonly [number, number, number]): [number, number, number] {
    const cell = this.safeCellSize();
    return [Math.floor(pos[0] / cell), Math.floor(pos[1] / cell), Math.floor(pos[2] / cell)];
  }

  private cellKey(pos: readonly [number, number, number]): string {
    const cell = this.toCell(pos);
    return `${cell[0]},${cell[1]},${cell[2]}`;
  }
}

export const constructionSnapMath = { rotateYQuarter, normalize, compatibilityRank };
