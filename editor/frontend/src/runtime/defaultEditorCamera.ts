import type { EditorCameraPose, EditorCameraState } from "./runtimeSchemas";

export const defaultEditorCameraPose: EditorCameraPose = {
  position: [96, 80, 96],
  target: [64, 48, 64],
  yaw: -Math.PI / 4,
  pitch: -0.45,
  roll: 0,
  radius: 64,
  fovDegrees: 70,
  orthographicScale: 96,
};

export const createDefaultEditorCameraState = (): EditorCameraState => ({
  interactionMode: "menu",
  cameraKind: "firstPerson",
  projection: "perspective",
  pose: {
    ...defaultEditorCameraPose,
    position: [...defaultEditorCameraPose.position],
    target: [...defaultEditorCameraPose.target],
  },
  alignToAxes: false,
  automaticAxis: true,
  savedCameras: [],
});
