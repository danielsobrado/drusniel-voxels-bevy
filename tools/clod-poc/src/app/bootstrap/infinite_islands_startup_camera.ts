export interface StartupCameraPose {
  eye: readonly [number, number, number];
  target: readonly [number, number, number];
}

const DEFAULT_CAMERA_HEIGHT_RATIO = 0.7;
const DEFAULT_LOOK_OFFSET_RATIO = 0.28;
const DEFAULT_TARGET_HEIGHT_M = 24;

export function defaultStartupCameraPose(
  scene: string | null,
  worldCells: number,
): StartupCameraPose {
  const mid = worldCells * 0.5;
  if (scene === "infinite-islands") {
    return {
      eye: [mid, worldCells * DEFAULT_CAMERA_HEIGHT_RATIO, mid],
      target: [mid, DEFAULT_TARGET_HEIGHT_M, mid - worldCells * DEFAULT_LOOK_OFFSET_RATIO],
    };
  }

  return {
    eye: [mid, worldCells * DEFAULT_CAMERA_HEIGHT_RATIO, mid + worldCells * 1.1],
    target: [mid, DEFAULT_TARGET_HEIGHT_M, mid],
  };
}
