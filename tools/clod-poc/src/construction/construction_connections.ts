import { constructionSnapMath, type ConstructionSnapIndex } from "./snap_index.js";
import type { ConstructionPieceDef, IndexedConstructionSnapPoint, SnapGroup } from "./types.js";

const DEFAULT_MIN_ALIGNMENT = 0.70;

type Vec3 = readonly [number, number, number];

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
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

function socketFramesAlign(
  sourceGroup: SnapGroup,
  targetGroup: SnapGroup,
  sourceDirection: Vec3,
  targetDirection: Vec3,
  minAlignment: number,
): boolean {
  // Wall-to-floor connections are intentionally orthogonal.
  if (isWallFloorPair(sourceGroup, targetGroup)) return true;
  return -dot(sourceDirection, targetDirection) >= minAlignment;
}

export interface FindConstructionConnectionsInput {
  snapIndex: ConstructionSnapIndex;
  piece: ConstructionPieceDef;
  position: readonly [number, number, number];
  rotationQuarterTurns: number;
  toleranceM: number;
  requiredTargetId?: string;
  minAlignment?: number;
}

export function findConstructionConnectionIds(input: FindConstructionConnectionsInput): readonly string[] {
  const ids = new Set<string>();
  if (input.requiredTargetId) ids.add(input.requiredTargetId);
  const minAlignment = input.minAlignment ?? DEFAULT_MIN_ALIGNMENT;

  for (const source of input.piece.snapPoints) {
    const offset = constructionSnapMath.rotateYQuarter(source.localPos, input.rotationQuarterTurns);
    const sourceDirection = constructionSnapMath.rotateYQuarter(source.direction, input.rotationQuarterTurns);
    const worldPosition: readonly [number, number, number] = [
      input.position[0] + offset[0],
      input.position[1] + offset[1],
      input.position[2] + offset[2],
    ];
    for (const target of input.snapIndex.queryRadius(worldPosition, input.toleranceM)) {
      if (!accepts(source.accepts, source.group, target)) continue;
      if (!socketFramesAlign(source.group, target.group, sourceDirection, target.worldDirection, minAlignment)) continue;
      ids.add(target.entityId);
    }
  }
  return [...ids].sort();
}
