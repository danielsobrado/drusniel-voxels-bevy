import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import type {
  GrassAppearanceSettings,
  GrassLighting,
  GrassRingInstanceBuffers,
  GrassSettings,
  GrassTier,
} from "../grass.js";
import type { EnvironmentLighting } from "../environment/environment.js";

export interface GrassNodeParams {
  lighting: EnvironmentLighting;
  bladeWidth: number;
  windStrength: number;
  windSpeed: number;
  gustStrength?: number;
  windDirection?: readonly [number, number];
  windTurbulence?: number;
  appearance?: GrassAppearanceSettings;
  mode?: GrassSettings["shaderMode"];
  alphaToCoverage?: boolean;
  distance?: number;
  ring?: GrassSettings["ring"];
  lod?: GrassSettings["lod"];
  fadeCenter?: THREE.Vector2;
  debugAttributes?: boolean;
  ringInstanceBuffers?: GrassRingInstanceBuffers;
  hydrologyWaterTexture?: THREE.Texture | null;
  worldSize?: number;
  hydrologyRes?: number;
  waterClearance?: number;
  tierBaseOffset?: number;
}

export interface GrassNodeMaterialHandle {
  material: MeshBasicNodeMaterial;
  setTime(t: number): void;
  setFadeCenter(x: number, z: number): void;
  updateSettings(settings: Pick<GrassSettings, "bladeWidth" | "windStrength" | "windSpeed" | "distance" | "alphaToCoverage" | "ring" | "lod"> & Partial<Pick<GrassSettings, "wind" | "appearance">>): void;
  updateLighting(lighting: EnvironmentLighting | GrassLighting): void;
}

export interface GrassInstancedGeometryOptions {
  mode?: GrassSettings["shaderMode"];
  tier?: GrassTier;
  crossed?: boolean;
  edgeShape?: boolean;
  settings?: GrassSettings;
}
