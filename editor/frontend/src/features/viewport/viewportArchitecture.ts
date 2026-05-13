import type { EditorViewportContract } from "../../types/editor";

export const LITE_VOXEL_VIEWPORT_CONTRACT: EditorViewportContract = {
  role: "authoring",
  implementation: "liteVoxel",
  ownsRuntimeRendering: false,
  ownsWorldPersistence: false,
};

export const NATIVE_BEVY_VIEWPORT_CONTRACT: EditorViewportContract = {
  role: "validation",
  implementation: "nativeBevy",
  ownsRuntimeRendering: true,
  ownsWorldPersistence: false,
};

export const AUTHORING_VIEWPORT_DATA_CONTRACTS = [
  "ViewportSnapshot",
  "ViewportMeshPayload",
  "ViewportMeshBuffer",
  "ProtectedArea",
  "BlockAtlasMap",
] as const;

export type AuthoringViewportDataContract = (typeof AUTHORING_VIEWPORT_DATA_CONTRACTS)[number];

export const AUTHORING_VIEWPORT_NON_GOALS = [
  "GTAO",
  "reflections",
  "fog",
  "waterShader",
  "propRenderer",
  "compositor",
  "cinematicPhotoMode",
  "physics",
  "worldPersistence",
] as const;

export type AuthoringViewportNonGoal = (typeof AUTHORING_VIEWPORT_NON_GOALS)[number];
