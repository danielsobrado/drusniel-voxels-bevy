import type * as THREE from "three";
import type { WaterDebugModeId, WaterVisualConfig } from "./waterConfig.js";
import type { CausticsConfig } from "./causticsConfig.js";

export interface WaterMaterialParams {
  visual: WaterVisualConfig;
  debugMode: WaterDebugModeId;
  sunDirection: THREE.Vector3;
  cameraPosition: THREE.Vector3;
  worldBounds: { cellsX: number; cellsZ: number };
  caustics?: CausticsConfig;
}

export interface WaterMaterialHandle {
  material: THREE.Material;
  setTime(t: number): void;
  setDebugMode(mode: WaterDebugModeId): void;
  setInnerRect(minX: number, minZ: number, maxX: number, maxZ: number): void;
  setLevelId(level: number): void;
  setClipmapTint(enabled: boolean): void;
  setWireframe(enabled: boolean): void;
  updateCamera(pos: THREE.Vector3): void;
  updateSunDirection(dir: THREE.Vector3): void;
  updateVisual(visual: WaterVisualConfig): void;
  dispose(): void;
}
