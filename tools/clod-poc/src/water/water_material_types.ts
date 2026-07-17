import type * as THREE from "three";
import type { WaterDebugModeId, WaterVisualConfig } from "./waterConfig.js";
import type { CausticsConfig } from "./causticsConfig.js";

/** Static-topology clipmap level resources (Phase 5b): per-level toroidal texel
 *  textures the material's vertex stage samples instead of CPU-filled attributes.
 *  Texture A = (waterY, terrainY, bodyMask, bodyKind); B = (flowX, flowZ, speed, drop);
 *  C = shoreDistance (r32float). */
export interface WaterStaticGridParams {
  texelsA: THREE.DataTexture;
  texelsB: THREE.DataTexture;
  texelsC: THREE.DataTexture;
  vertsPerEdge: number;
  cellSize: number;
}

export interface WaterStaticGridHandle {
  /** Per-snap origin update: world position of grid vertex (0,0) and the toroidal
   *  slot of the ring's min corner ((baseCol mod verts, baseRow mod verts)). */
  setOrigin(originMinX: number, originMinZ: number, baseSlotX: number, baseSlotZ: number): void;
}

/** Atlas-driven clipmap level resources (Phase W2): the vertex stage fetches water
 *  data straight from the shared streaming hydrology atlas (Layout A + B) with a
 *  manual validity-weighted bilinear, so a snap costs two origin uniforms and refills
 *  take zero CPU field samples. Texel lattice/validity semantics come from
 *  hydrologyAtlas.ts (Layout A alpha < 0 = no tile data yet). */
export interface WaterAtlasGridParams {
  /** Layout A: R = waterY, G = wetMask, B = carvedBedY, A = shoreDistance. */
  atlasA: THREE.DataTexture;
  /** Layout B: R = flowX, G = flowZ, B = flowStrength, A = bodyKind. */
  atlasB: THREE.DataTexture;
  /** Texels per atlas edge. */
  res: number;
  /** Atlas texel size in metres. */
  atlasCellSize: number;
  /** This level's grid cell size in metres. */
  levelCellSize: number;
}

export interface WaterAtlasGridHandle {
  /** Per-snap: world position of grid vertex (0, 0). */
  setOrigin(originMinX: number, originMinZ: number): void;
  /** Per-frame: world position of atlas texel (0, 0); enabled=false renders dry. */
  setWindow(originX: number, originZ: number, enabled: boolean): void;
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
  /** Offered for atlas-covered levels; wins over staticGrid in TSL materials. */
  atlasGrid?: WaterAtlasGridParams;
}

export interface WaterMaterialHandle {
  material: THREE.Material;
  /** Present when the material consumed params.staticGrid (static-topology mode). */
  staticGrid?: WaterStaticGridHandle;
  /** Present when the material consumed params.atlasGrid (atlas-driven mode). */
  atlasGrid?: WaterAtlasGridHandle;
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
