export interface StartupCameraPose {
  eye: readonly [number, number, number];
  target: readonly [number, number, number];
}

const OVERVIEW_CAMERA_HEIGHT_RATIO = 0.45;
const OVERVIEW_CAMERA_BACK_RATIO = 0.82;
const INFINITE_LOOK_OFFSET_RATIO = 0.34;
const DEFAULT_TARGET_HEIGHT_M = 30;

export function defaultStartupCameraPose(
  scene: string | null,
  worldCells: number,
): StartupCameraPose {
  const mid = worldCells * 0.5;
  if (scene === "cave-test") {
    return {
      eye: [720, 48, 60],
      target: [720, 30, 100],
    };
  }
  if (scene === "infinite-islands") {
    return {
      eye: [mid, worldCells * OVERVIEW_CAMERA_HEIGHT_RATIO, mid],
      target: [mid, DEFAULT_TARGET_HEIGHT_M, mid - worldCells * INFINITE_LOOK_OFFSET_RATIO],
    };
  }

  return {
    eye: [mid, worldCells * OVERVIEW_CAMERA_HEIGHT_RATIO, mid + worldCells * OVERVIEW_CAMERA_BACK_RATIO],
    target: [mid, DEFAULT_TARGET_HEIGHT_M, mid],
  };
}
