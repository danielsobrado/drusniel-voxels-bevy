import type * as THREE from "three";
import type { WaterDebugModeId, WaterVisualConfig } from "./waterConfig.js";
import type { CausticsConfig } from "./causticsConfig.js";

/** Static-topology clipmap level resources (Phase 5b): per-level toroidal texel
 *  textures the material's vertex stage samples instead of CPU-filled attributes.
 *  Texture A = (waterY, terrainY, bodyMask, bodyKind); B = (flowX, flowZ, speed, drop). */
export interface WaterStaticGridParams {
  texelsA: THREE.DataTexture;
  texelsB: THREE.DataTexture;
  vertsPerEdge: number;
  cellSize: number;
}

export interface WaterStaticGridHandle {
  /** Per-snap origin update: world position of grid vertex (0,0) and the toroidal
   *  slot of the ring's min corner ((baseCol mod verts, baseRow mod verts)). */
  setOrigin(originMinX: number, originMinZ: number, baseSlotX: number, baseSlotZ: number): void;
}

export interface WaterMaterialParams {
  visual: WaterVisualConfig;
  debugMode: WaterDebugModeId;
  sunDirection: THREE.Vector3;
  cameraPosition: THREE.Vector3;
  worldBounds: { cellsX: number; cellsZ: number };
  caustics?: CausticsConfig;
  /** Offered by the clipmap when static topology is enabled; materials that support it
   *  return `staticGrid` on their handle, otherwise the level falls back to the legacy
   *  CPU vertex-buffer path (the WebGL shader material does this). */
  staticGrid?: WaterStaticGridParams;
}

export interface WaterMaterialHandle {
  material: THREE.Material;
  /** Present when the material consumed params.staticGrid (static-topology mode). */
  staticGrid?: WaterStaticGridHandle;
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
