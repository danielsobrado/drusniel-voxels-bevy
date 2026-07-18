export interface ScreenLandmark {
  readonly id: string;
  readonly xPx: number;
  readonly yPx: number;
  readonly depthNdc: number;
  readonly visible: boolean;
}

export interface LandmarkDriftSignals {
  readonly maxLandmarkDriftPx: number | null;
  readonly terrainPropRelativeDriftPx: number | null;
  readonly missingOrInvisibleIds: readonly string[];
}

function visibleById(positions: readonly ScreenLandmark[]): Map<string, ScreenLandmark> {
  return new Map(positions.filter((position) => position.visible).map((position) => [position.id, position]));
}

export function landmarkDriftSignals(
  first: readonly ScreenLandmark[],
  second: readonly ScreenLandmark[],
  terrainId: string,
  propId: string,
): LandmarkDriftSignals {
  const firstById = visibleById(first);
  const secondById = visibleById(second);
  const allIds = [...new Set([...first.map(({ id }) => id), ...second.map(({ id }) => id), terrainId, propId])].sort();
  const missingOrInvisibleIds = allIds.filter((id) => !firstById.has(id) || !secondById.has(id));
  if (missingOrInvisibleIds.length > 0) {
    return { maxLandmarkDriftPx: null, terrainPropRelativeDriftPx: null, missingOrInvisibleIds };
  }

  const maxLandmarkDriftPx = Math.max(...allIds.map((id) => {
    const a = firstById.get(id)!;
    const b = secondById.get(id)!;
    return Math.hypot(b.xPx - a.xPx, b.yPx - a.yPx);
  }));
  const terrainA = firstById.get(terrainId)!;
  const terrainB = secondById.get(terrainId)!;
  const propA = firstById.get(propId)!;
  const propB = secondById.get(propId)!;
  const relativeAX = propA.xPx - terrainA.xPx;
  const relativeAY = propA.yPx - terrainA.yPx;
  const relativeBX = propB.xPx - terrainB.xPx;
  const relativeBY = propB.yPx - terrainB.yPx;
  return {
    maxLandmarkDriftPx,
    terrainPropRelativeDriftPx: Math.hypot(relativeBX - relativeAX, relativeBY - relativeAY),
    missingOrInvisibleIds,
  };
}
