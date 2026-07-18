import type { ContinentRiverCrossingRoute } from "../../src/water/continent_river_route.js";

const DEFAULT_BOUNDARY_LEAD_M = 8;
const DEFAULT_MIN_POST_BOUNDARY_DRY_M = 8;
const MIN_DIRECTION_LENGTH = 0.001;

export interface PlayableSliceRoutePlan {
  readonly spawn: readonly [number, number];
  readonly yaw: number;
  readonly direction: readonly [number, number];
  readonly boundary: readonly [number, number];
  readonly boundaryDistanceM: number;
  readonly waterEntry: readonly [number, number];
  readonly riverCenter: readonly [number, number];
  readonly riverEnd: readonly [number, number];
  readonly pageSizeM: number;
}

interface BoundaryCandidate {
  distanceM: number;
  point: [number, number];
}

function candidatesForAxis(
  start: readonly [number, number],
  direction: readonly [number, number],
  lengthM: number,
  pageSizeM: number,
  axis: 0 | 1,
): BoundaryCandidate[] {
  const component = direction[axis];
  if (Math.abs(component) < MIN_DIRECTION_LENGTH) return [];
  const startValue = start[axis];
  const endValue = startValue + component * lengthM;
  const minPage = Math.floor(Math.min(startValue, endValue) / pageSizeM);
  const maxPage = Math.floor(Math.max(startValue, endValue) / pageSizeM);
  const candidates: BoundaryCandidate[] = [];

  for (let page = minPage + 1; page <= maxPage; page++) {
    const boundaryValue = page * pageSizeM;
    const distanceM = (boundaryValue - startValue) / component;
    if (!(distanceM > 0 && distanceM < lengthM)) continue;
    candidates.push({
      distanceM,
      point: [
        start[0] + direction[0] * distanceM,
        start[1] + direction[1] * distanceM,
      ],
    });
  }
  return candidates;
}

export function playerYawForDirection(direction: readonly [number, number]): number {
  return Math.atan2(-direction[0], -direction[1]);
}

export function planPlayableSliceRoute(
  route: ContinentRiverCrossingRoute,
  pageSizeM: number,
  boundaryLeadM = DEFAULT_BOUNDARY_LEAD_M,
): PlayableSliceRoutePlan {
  if (!Number.isFinite(pageSizeM) || pageSizeM <= 0) throw new Error("pageSizeM must be positive");
  const dx = route.center[0] - route.start[0];
  const dz = route.center[1] - route.start[1];
  const centerDistanceM = Math.hypot(dx, dz);
  if (centerDistanceM < MIN_DIRECTION_LENGTH) throw new Error("river route start and center must differ");
  const direction: [number, number] = [dx / centerDistanceM, dz / centerDistanceM];
  const waterDx = route.waterEntry[0] - route.start[0];
  const waterDz = route.waterEntry[1] - route.start[1];
  const waterEntryDistanceM = waterDx * direction[0] + waterDz * direction[1];
  const waterEntryLateralM = Math.abs(waterDx * direction[1] - waterDz * direction[0]);
  if (
    waterEntryDistanceM <= 0
    || waterEntryDistanceM > centerDistanceM
    || waterEntryLateralM > 1
  ) {
    throw new Error("river route water entry must lie on the dry-bank approach");
  }

  const candidates = [
    ...candidatesForAxis(route.start, direction, waterEntryDistanceM, pageSizeM, 0),
    ...candidatesForAxis(route.start, direction, waterEntryDistanceM, pageSizeM, 1),
  ]
    .filter((candidate) => candidate.distanceM >= boundaryLeadM)
    .filter((candidate) => waterEntryDistanceM - candidate.distanceM >= DEFAULT_MIN_POST_BOUNDARY_DRY_M)
    .sort((a, b) => a.distanceM - b.distanceM);
  const selected = candidates[0];
  if (!selected) {
    throw new Error(
      `river approach does not cross a page boundary with ${boundaryLeadM}m lead and `
        + `${DEFAULT_MIN_POST_BOUNDARY_DRY_M}m before the shoreline`,
    );
  }
  const spawn: [number, number] = [
    selected.point[0] - direction[0] * boundaryLeadM,
    selected.point[1] - direction[1] * boundaryLeadM,
  ];

  return {
    spawn,
    yaw: playerYawForDirection(direction),
    direction,
    boundary: selected.point,
    boundaryDistanceM: boundaryLeadM,
    waterEntry: [...route.waterEntry],
    riverCenter: [...route.center],
    riverEnd: [...route.end],
    pageSizeM,
  };
}
