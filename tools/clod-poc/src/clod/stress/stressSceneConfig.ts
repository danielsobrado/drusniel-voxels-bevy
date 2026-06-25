export const STRESS_SCENE_NAMES = [
  "ridge_border",
  "cliff_corner",
  "cave_mouth_border",
  "thin_bridge",
  "near_field_bubble",
  "flat",
  "rolling_hill",
] as const;

export type StressSceneName = typeof STRESS_SCENE_NAMES[number];

export interface StressSceneParams {
  sceneName: StressSceneName;
  lod0PagesX: number;
  lod0PagesZ: number;
  chunksPerPage: number;
  chunkSize: number;
}

export const DEFAULT_STRESS_PARAMS: StressSceneParams = {
  sceneName: "ridge_border",
  lod0PagesX: 8,
  lod0PagesZ: 8,
  chunksPerPage: 4,
  chunkSize: 16,
};
