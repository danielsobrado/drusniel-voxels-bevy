import * as THREE from "three";

export interface TreeIsolatedRenderer {
  getRenderTarget(): THREE.RenderTarget | null;
  setRenderTarget(target: THREE.RenderTarget | null): void;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
}

export type {
  FallingTree,
  TreeImpostorStatus,
  TreeLightingProxy,
  TreeStats,
  TreeSystemOptions,
  TreeWebGpuBackendAccess,
} from "./tree_system_types.js";
