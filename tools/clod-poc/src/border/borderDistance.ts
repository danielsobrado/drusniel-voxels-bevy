import type { WorldBoundsConfig } from "../config/borderCoastOceanConfig.js";

export interface BorderPosition {
  x: number;
  z: number;
}

export interface BorderNormal {
  x: number;
  z: number;
}

export type BorderSide = "north" | "south" | "east" | "west" | "corner";

export interface BorderDistanceResult {
  inside: boolean;
  distanceToNearestBorder: number;
  nearestBorderNormal: BorderNormal;
  nearestSide: BorderSide;
  /** Positive inside, zero on the border, negative outside. */
  signedDistanceToPlayableArea: number;
}

function normalize(x: number, z: number): BorderNormal {
  const length = Math.hypot(x, z);
  return length > 0 ? { x: x / length, z: z / length } : { x: 0, z: 0 };
}

function validateInputs(pos: BorderPosition, bounds: WorldBoundsConfig): void {
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.z)) {
    throw new Error("Border distance: position must contain finite x and z values");
  }
  if (
    !Number.isFinite(bounds.min_x)
    || !Number.isFinite(bounds.max_x)
    || !Number.isFinite(bounds.min_z)
    || !Number.isFinite(bounds.max_z)
    || bounds.min_x >= bounds.max_x
    || bounds.min_z >= bounds.max_z
  ) {
    throw new Error("Border distance: bounds must be finite and have min values below max values");
  }
}

export function computeBorderDistance(
  pos: BorderPosition,
  bounds: WorldBoundsConfig,
): BorderDistanceResult {
  validateInputs(pos, bounds);

  const outsideX = pos.x < bounds.min_x
    ? pos.x - bounds.min_x
    : pos.x > bounds.max_x
      ? pos.x - bounds.max_x
      : 0;
  const outsideZ = pos.z < bounds.min_z
    ? pos.z - bounds.min_z
    : pos.z > bounds.max_z
      ? pos.z - bounds.max_z
      : 0;
  const inside = outsideX === 0 && outsideZ === 0;

  if (!inside) {
    const distance = Math.hypot(outsideX, outsideZ);
    const outsideBothAxes = outsideX !== 0 && outsideZ !== 0;
    const nearestSide: BorderSide = outsideBothAxes
      ? "corner"
      : outsideX < 0
        ? "west"
        : outsideX > 0
          ? "east"
          : outsideZ < 0
            ? "south"
            : "north";
    return {
      inside: false,
      distanceToNearestBorder: distance,
      nearestBorderNormal: normalize(outsideX, outsideZ),
      nearestSide,
      signedDistanceToPlayableArea: -distance,
    };
  }

  const west = pos.x - bounds.min_x;
  const east = bounds.max_x - pos.x;
  const south = pos.z - bounds.min_z;
  const north = bounds.max_z - pos.z;
  const nearestX = Math.min(west, east);
  const nearestZ = Math.min(south, north);
  const onXBorder = nearestX === 0;
  const onZBorder = nearestZ === 0;

  if (onXBorder && onZBorder) {
    const normalX = west === 0 ? -1 : 1;
    const normalZ = south === 0 ? -1 : 1;
    return {
      inside: true,
      distanceToNearestBorder: 0,
      nearestBorderNormal: normalize(normalX, normalZ),
      nearestSide: "corner",
      signedDistanceToPlayableArea: 0,
    };
  }

  if (nearestX <= nearestZ) {
    const westIsNearest = west <= east;
    return {
      inside: true,
      distanceToNearestBorder: nearestX,
      nearestBorderNormal: { x: westIsNearest ? -1 : 1, z: 0 },
      nearestSide: westIsNearest ? "west" : "east",
      signedDistanceToPlayableArea: nearestX,
    };
  }

  const southIsNearest = south <= north;
  return {
    inside: true,
    distanceToNearestBorder: nearestZ,
    nearestBorderNormal: { x: 0, z: southIsNearest ? -1 : 1 },
    nearestSide: southIsNearest ? "south" : "north",
    signedDistanceToPlayableArea: nearestZ,
  };
}
