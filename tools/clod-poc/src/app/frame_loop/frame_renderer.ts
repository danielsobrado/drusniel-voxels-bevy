import type * as THREE from "three";

export interface FrameRendererInfo {
  render: { drawCalls?: number; triangles?: number };
}

export interface FrameRenderer {
  readonly domElement: HTMLCanvasElement;
  setAnimationLoop(callback: ((time: number, frame?: XRFrame) => void) | null): void;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  readonly info?: FrameRendererInfo;
}
