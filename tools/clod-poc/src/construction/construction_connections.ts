import { constructionSnapMath, type ConstructionSnapIndex } from "./snap_index.js";
import type { ConstructionPieceDef, IndexedConstructionSnapPoint, SnapGroup } from "./types.js";

function accepts(sourceAccepts: readonly SnapGroup[], sourceGroup: SnapGroup, target: IndexedConstructionSnapPoint): boolean {
  const sourceAllowsTarget = sourceAccepts.length === 0 || sourceAccepts.includes(target.group);
  const targetAllowsSource = target.accepts.length === 0 || target.accepts.includes(sourceGroup);
  return sourceAllowsTarget && targetAllowsSource;
}

export interface FindConstructionConnectionsInput {
  snapIndex: ConstructionSnapIndex;
  piece: ConstructionPieceDef;
  position: readonly [number, number, number];
  rotationQuarterTurns: number;
  toleranceM: number;
  requiredTargetId?: string;
}

export function findConstructionConnectionIds(input: FindConstructionConnectionsInput): readonly string[] {
  const ids = new Set<string>();
  if (input.requiredTargetId) ids.add(input.requiredTargetId);
  for (const source of input.piece.snapPoints) {
    const offset = constructionSnapMath.rotateYQuarter(source.localPos, input.rotationQuarterTurns);
    const worldPosition: readonly [number, number, number] = [
      input.position[0] + offset[0],
      input.position[1] + offset[1],
      input.position[2] + offset[2],
    ];
    for (const target of input.snapIndex.queryRadius(worldPosition, input.toleranceM)) {
      if (accepts(source.accepts, source.group, target)) ids.add(target.entityId);
    }
  }
  return [...ids].sort();
}
