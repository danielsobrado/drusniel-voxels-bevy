import * as THREE from "three";
import type { ClodPageNode } from "../../types.js";
import type { BorderCoastOceanConfig } from "../../terrain/border_coast_config.js";
import type {
  WaterConfig,
  WaterDebugState,
  WATER_DEBUG_MODES,
  WaterEffectKey,
  WaterEffectsState,
} from "../../water/index.js";
import type { WaterField, WaterClipmap } from "../../water/index.js";
import type { HydrologySystem } from "../../water/hydrologySystem.js";
import type { EditedWaterAuthoritySource, WaterAuthority } from "../../water/water_authority.js";
import type { RiverCascadeParticleStats } from "../../water/riverCascadeParticleOverlay.js";
import type { ComposedEnvironmentQuery } from "../../environment_query/runtime.js";

export interface WaterControllerUiState {
  waterEnabled: boolean;
  waterDebugMode: keyof typeof WATER_DEBUG_MODES;
  waterClipmapTint: boolean;
  waterWireframe: boolean;
  waterDepthWrite: boolean;
}

export interface WaterDebugPoseHooks {
  exitToOrbit: () => void;
  resetPlayerInput: () => void;
  setControlsEnabled: (enabled: boolean) => void;
  setControlsTarget: (x: number, y: number, z: number) => void;
  setCameraPosition: (x: number, y: number, z: number) => void;
  cameraLookAt: (x: number, y: number, z: number) => void;
  controlsUpdate: () => void;
  updatePlayerModeUi: () => void;
  updateSelection: () => void;
  setWaterDebugModeState: (mode: keyof typeof WATER_DEBUG_MODES) => void;
}

export interface WaterControllerDeps {
  scene: THREE.Scene;
  nodes: ClodPageNode[];
  waterConfig: WaterConfig;
  worldCells: number;
  isWebGpu: boolean;
  surfaceHeight: (x: number, z: number) => number;
  hydrologySystem: HydrologySystem | null;
  camera: THREE.Camera;
  getSunDirection: () => THREE.Vector3;
  getUiState: () => WaterControllerUiState;
  searchParams: URLSearchParams;
  devMode: boolean;
  borderCoastOceanConfig?: BorderCoastOceanConfig;
}

export interface WaterRuntimeFeatures {
  readonly highQualityMaterial: boolean;
  readonly ssr: boolean;
  readonly refraction: boolean;
  readonly caustics: boolean;
  readonly atlasDrivenLevelCount: number;
  readonly clipmapOuterHalfSpanM: number;
  readonly clipmapGuaranteedHalfSpanM: number;
}

export interface WaterController {
  readonly field: WaterField;
  readonly clipmap: WaterClipmap;
  readonly authority: WaterAuthority;
  readonly editedWater: EditedWaterAuthoritySource;
  readonly environmentQuery: ComposedEnvironmentQuery | null;
  readonly debugState: WaterDebugState;
  readonly runtimeFeatures: WaterRuntimeFeatures;
  makeVisual(): { depthWrite: boolean } & WaterConfig["visual"];
  getEffectsState(): Readonly<WaterEffectsState>;
  setEffectEnabled(effect: WaterEffectKey, enabled: boolean): void;
  setVisible(enabled: boolean): void;
  setDebugMode(mode: keyof typeof WATER_DEBUG_MODES): void;
  setClipmapTint(enabled: boolean): void;
  setWireframe(enabled: boolean): void;
  setShoreSurfEnabled(enabled: boolean): void;
  setShoreSurfStartDistance(distance: number): void;
  setShoreSurfFullDistance(distance: number): void;
  setShoreSurfMaxDepth(depth: number): void;
  setRiverMistEnabled(enabled: boolean): void;
  updateVisual(visual: ReturnType<WaterController["makeVisual"]>): void;
  updateSunDirection(direction: THREE.Vector3): void;
  update(deltaSeconds: number, cameraPosition: THREE.Vector3): void;
  getCascadeParticleStats(): RiverCascadeParticleStats;
  installDebugApi(hooks: WaterDebugPoseHooks): void;
  logDevInitOnce(worldCells: number): void;
  dispose(): void;
}
