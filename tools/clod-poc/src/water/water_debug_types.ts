import type { WaterDebugMode } from "./waterConfig.js";
import type { RiverCascadeParticleStats } from "./riverCascadeParticleOverlay.js";

export interface WaterDebugState {
  enabled: boolean;
  mode: WaterDebugMode;
  clipmapTint: boolean;
  wireframe: boolean;
  depthWrite: boolean;
  shoreSurfEnabled: boolean;
  shoreSurfStartDistance: number;
  shoreSurfFullDistance: number;
  shoreSurfMaxDepth: number;
  riverSource: "hydrology" | "fake_bodies";
  riversFallback: boolean;
  riverMain: boolean;
  riverTributaries: boolean;
  riverWidth: number;
  riverVisibleDepth: number;
  riverCarveDepth: number;
  riverFlowSpeed: number;
  riverFoamStrength: number;
  riverMistEnabled: boolean;
}

export interface WaterRiverDebugStats {
  source: string;
  hydrologyEnabled: boolean;
  riverCells: number;
  lakeCells: number;
  wetCells: number;
  maxFlowSpeed: number;
  fallbackRivers: boolean;
  fallbackMainRiver: boolean;
  fallbackTributaries: boolean;
  widenRadius: number;
  carveDepthM: number;
  visibleDepthM: number;
  flowSpeedMultiplier: number;
  fakeRiverCount: number;
}

export interface WaterDebugBindings {
  onEnabled: (enabled: boolean) => void;
  onMode: (mode: WaterDebugMode) => void;
  onClipmapTint: (enabled: boolean) => void;
  onWireframe: (enabled: boolean) => void;
  onDepthWrite: (depthWrite: boolean) => void;
  onShoreSurfEnabled: (enabled: boolean) => void;
  onShoreSurfStartDistance: (distance: number) => void;
  onShoreSurfFullDistance: (distance: number) => void;
  onShoreSurfMaxDepth: (depth: number) => void;
  onRiverMistEnabled: (enabled: boolean) => void;
  onRebuildVisual: () => void;
  getRiverStats?: () => WaterRiverDebugStats;
  getCascadeParticleStats?: () => RiverCascadeParticleStats;
}

export interface WaterDebugController {
  refreshDisplay: () => void;
}
