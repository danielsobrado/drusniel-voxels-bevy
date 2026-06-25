import type * as THREE from "three";
import type { PostProcessSettings } from "../postprocess.js";

export interface AppPostProcess {
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  setSize(width: number, height: number): void;
  updateSettings(settings: Partial<PostProcessSettings>): void;
  dispose(): void;
}
