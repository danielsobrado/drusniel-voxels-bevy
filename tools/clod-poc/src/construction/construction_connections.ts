import type { ConstructionSnapIndex } from "./snap_index.js";
import type {
  ConstructionPieceDef,
  ConstructionVec3,
  IndexedConstructionSnapPoint,
  SnapGroup,
} from "./types.js";

function rotateYQuarter(value: ConstructionVec3, quarterTurns: number): ConstructionVec3 {
  const turns = ((quarterTurns % 4) + 4) % 4;
  const [x, y, z] = value;
  if (turns === 1) return [z, y, -x];
  if (turns === 2) return [-x, y, -z];
  if (turns === 3) return [-z, y, x];
  return [x, y, z];
}

function add(a: ConstructionVec3, b: ConstructionVec3): ConstructionVec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function dot(a: ConstructionVec3, b: ConstructionVec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function isWallFloorPair(source: SnapGroup, target: SnapGroup): boolean {
  return ((source === "wall-bottom" || source === "wall-top") && target === "floor-edge")
    || (source === "floor-edge" && (target === "wall-bottom" || target === "wall-top"));
}

function directionsAlign(
  sourceGroup: SnapGroup,
  targetGroup: SnapGroup,
  sourceDirection: ConstructionVec3,
  targetDirection: ConstructionVec3,
  minAlignment: number,
): boolean {
  if (isWallFloorPair(sourceGroup, targetGroup)) return true;
  return -dot(sourceDirection, targetDirection) >= minAlignment;
}

function groupsAccept(
  sourceGroup: SnapGroup,
  sourceAccepts: readonly SnapGroup[],
  target: IndexedConstructionSnapPoint,
): boolean {
  const sourceAllowsTarget = sourceAccepts.length === 0 || sourceAccepts.includes(target.group);
  const targetAllowsSource = target.accepts.length === 0 || target.accepts.includes(sourceGroup);
  return sourceAllowsTarget && targetAllowsSource;
}

export function findConstructionConnectionIds(input: {
  piece: ConstructionPieceDef;
  position: ConstructionVec3;
  rotationQuarterTurns: number;
  snapIndex: ConstructionSnapIndex;
  existingPieceIds: ReadonlySet<string>;
  toleranceM: number;
  minAlignment?: number;
}): readonly string[] {
  const tolerance = Math.max(0.001, input.toleranceM);
  const connected = new Set<string>();
  const minAlignment = input.minAlignment ?? 0.70;
  for (const source of input.piece.snapPoints) {
    const sourceWorld = add(input.position, rotateYQuarter(source.localPos, input.rotationQuarterTurns));
    const sourceDirection = rotateYQuarter(source.direction, input.rotationQuarterTurns);
    for (const target of input.snapIndex.queryRadius(sourceWorld, tolerance)) {
      if (!input.existingPieceIds.has(target.entityId)) continue;
      if (!groupsAccept(source.group, source.accepts, target)) continue;
      if (!directionsAlign(source.group, target.group, sourceDirection, target.worldDirection, minAlignment)) continue;
      connected.add(target.entityId);
    }
  }
  return [...connected].sort();
}
