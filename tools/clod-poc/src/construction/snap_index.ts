import type { ConstructionPieceDef, ConstructionSnapConfig, ConstructionSnapResult, IndexedConstructionSnapPoint, SnapGroup } from "./types.js";

const EPSILON = 0.000001;
const ROTATION_PREFERENCE_PENALTY = 0.01;

function dot(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(value: readonly [number, number, number]): [number, number, number] {
  const len = Math.hypot(value[0], value[1], value[2]);
  if (len <= EPSILON) return [0, 1, 0];
  return [value[0] / len, value[1] / len, value[2] / len];
}

function normalizeOrNull(value: readonly [number, number, number]): [number, number, number] | null {
  const len = Math.hypot(value[0], value[1], value[2]);
  if (len <= EPSILON) return null;
  return [value[0] / len, value[1] / len, value[2] / len];
}

function normalizeHorizontalOrNull(value: readonly [number, number, number]): [number, number, number] | null {
  return normalizeOrNull([value[0], 0, value[2]]);
}

function normalizeQuarterTurns(quarterTurns: number): number {
  return ((quarterTurns % 4) + 4) % 4;
}

function rotateYQuarter(value: readonly [number, number, number], quarterTurns: number): [number, number, number] {
  const turns = normalizeQuarterTurns(quarterTurns);
  const [x, y, z] = value;
  if (turns === 1) return [z, y, -x];
  if (turns === 2) return [-x, y, -z];
  if (turns === 3) return [-z, y, x];
  return [x, y, z];
}

function add(a: readonly [number, number, number], b: readonly [number, number, number]): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(a: readonly [number, number, number], factor: number): [number, number, number] {
  return [a[0] * factor, a[1] * factor, a[2] * factor];
}

function sub(a: readonly [number, number, number], b: readonly [number, number, number]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function distance(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function accepts(sourceAccepts: readonly SnapGroup[], sourceGroup: SnapGroup, target: IndexedConstructionSnapPoint): boolean {
  const sourceAllowsTarget = sourceAccepts.length === 0 || sourceAccepts.includes(target.group);
  const targetAllowsSource = target.accepts.length === 0 || target.accepts.includes(sourceGroup);
  return sourceAllowsTarget && targetAllowsSource;
}

function isWallFloorPair(sourceGroup: SnapGroup, targetGroup: SnapGroup): boolean {
  return (sourceGroup === "wall-bottom" && targetGroup === "floor-edge")
    || (sourceGroup === "floor-edge" && targetGroup === "wall-bottom");
}

function wallHorizontalNormal(piece: ConstructionPieceDef, rotationQuarterTurns: number): [number, number, number] {
  const [width, , depth] = piece.dimensionsM;
  const localThinAxis: [number, number, number] = depth <= width ? [0, 0, 1] : [1, 0, 0];
  return normalize(rotateYQuarter(localThinAxis, rotationQuarterTurns));
}

function wallBottomToFloorEdgeAlignment(
  piece: ConstructionPieceDef,
  targetDir: readonly [number, number, number],
  rotationQuarterTurns: number,
): number | null {
  const floorEdgeDir = normalizeHorizontalOrNull(targetDir);
  if (!floorEdgeDir) return null;
  return Math.abs(dot(wallHorizontalNormal(piece, rotationQuarterTurns), floorEdgeDir));
}

function connectionAlignment(
  piece: ConstructionPieceDef,
  sourceGroup: SnapGroup,
  targetGroup: SnapGroup,
  sourceDir: readonly [number, number, number],
  targetDir: readonly [number, number, number],
  rotationQuarterTurns: number,
): number {
  if (sourceGroup === "wall-bottom" && targetGroup === "floor-edge") {
    const alignment = wallBottomToFloorEdgeAlignment(piece, targetDir, rotationQuarterTurns);
    if (alignment !== null) return alignment;
  }

  const opposed = -dot(sourceDir, targetDir);
  return isWallFloorPair(sourceGroup, targetGroup) ? Math.max(opposed, 1.0) : opposed;
}

function rotationCandidates(preferredQuarterTurns: number): number[] {
  const preferred = normalizeQuarterTurns(preferredQuarterTurns);
  return [0, 1, 2, 3].map((offset) => normalizeQuarterTurns(preferred + offset));
}

function rotationDeltaSteps(a: number, b: number): number {
  const delta = Math.abs(normalizeQuarterTurns(a) - normalizeQuarterTurns(b));
  return Math.min(delta, 4 - delta);
}

export class ConstructionSnapIndex {
  private readonly cells = new Map<string, IndexedConstructionSnapPoint[]>();

  constructor(private readonly cellSizeM: number) {}

  clear(): void {
    this.cells.clear();
  }

  insert(point: IndexedConstructionSnapPoint): void {
    const key = this.cellKey(point.worldPos);
    const list = this.cells.get(key) ?? [];
    list.push({
      ...point,
      worldDirection: normalize(point.worldDirection),
    });
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
    for (let dz = -cellRadius; dz <= cellRadius; dz += 1) {
      for (let dy = -cellRadius; dy <= cellRadius; dy += 1) {
        for (let dx = -cellRadius; dx <= cellRadius; dx += 1) {
          const key = `${base[0] + dx},${base[1] + dy},${base[2] + dz}`;
          const points = this.cells.get(key);
          if (!points) continue;
          for (const point of points) {
            if (distance(center, point.worldPos) <= radiusM) result.push(point);
          }
        }
      }
    }
    return result;
  }

  findBestSnap(
    cursorWorldPos: readonly [number, number, number],
    piece: ConstructionPieceDef,
    rotationQuarterTurns: number,
    config: ConstructionSnapConfig,
  ): ConstructionSnapResult | null {
    return this.findBestSnapFromTargets(
      this.queryRadius(cursorWorldPos, config.radiusM),
      piece,
      rotationQuarterTurns,
      config,
      (target) => 1 - Math.min(1, distance(cursorWorldPos, target.worldPos) / config.radiusM),
    );
  }

  findBestSnapOnRay(
    rayOrigin: readonly [number, number, number],
    rayDirection: readonly [number, number, number],
    maxDistanceM: number,
    piece: ConstructionPieceDef,
    rotationQuarterTurns: number,
    config: ConstructionSnapConfig,
  ): ConstructionSnapResult | null {
    const direction = normalizeOrNull(rayDirection);
    if (!direction) return null;
    const maxT = Math.max(0, maxDistanceM) + config.radiusM;

    return this.findBestSnapFromTargets(
      this.allPoints(),
      piece,
      rotationQuarterTurns,
      config,
      (target) => {
        const t = dot(sub(target.worldPos, rayOrigin), direction);
        if (t < 0 || t > maxT) return null;
        const closest = add(rayOrigin, scale(direction, t));
        const rayDistance = distance(closest, target.worldPos);
        if (rayDistance > config.radiusM) return null;
        return 1 - Math.min(1, rayDistance / config.radiusM);
      },
    );
  }

  size(): number {
    let total = 0;
    for (const points of this.cells.values()) total += points.length;
    return total;
  }

  private findBestSnapFromTargets(
    targets: Iterable<IndexedConstructionSnapPoint>,
    piece: ConstructionPieceDef,
    preferredRotationQuarterTurns: number,
    config: ConstructionSnapConfig,
    distanceScore: (target: IndexedConstructionSnapPoint, worldPosition: readonly [number, number, number]) => number | null,
  ): ConstructionSnapResult | null {
    let best: ConstructionSnapResult | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const target of targets) {
      piece.snapPoints.forEach((source, sourceSnapIndex) => {
        if (!accepts(source.accepts, source.group, target)) return;
        for (const candidateRotation of rotationCandidates(preferredRotationQuarterTurns)) {
          const sourceDir = normalize(rotateYQuarter(source.direction, candidateRotation));
          const alignment = connectionAlignment(piece, source.group, target.group, sourceDir, target.worldDirection, candidateRotation);
          if (alignment < config.minAlignment) continue;
          const sourceOffset = rotateYQuarter(source.localPos, candidateRotation);
          const worldPosition = sub(target.worldPos, sourceOffset);
          const snapDistanceScore = distanceScore(target, worldPosition);
          if (snapDistanceScore === null) continue;
          const score = config.alignmentWeight * alignment
            + config.distanceWeight * snapDistanceScore
            - ROTATION_PREFERENCE_PENALTY * rotationDeltaSteps(candidateRotation, preferredRotationQuarterTurns);
          if (score <= bestScore) continue;
          bestScore = score;
          best = {
            target,
            sourceSnapIndex,
            worldPosition,
            rotationQuarterTurns: candidateRotation,
            score,
          };
        }
      });
    }
    return best;
  }

  private *allPoints(): Iterable<IndexedConstructionSnapPoint> {
    for (const points of this.cells.values()) {
      for (const point of points) yield point;
    }
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

export const constructionSnapMath = {
  rotateYQuarter,
  normalize,
  normalizeQuarterTurns,
};
