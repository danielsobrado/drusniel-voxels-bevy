import type * as THREE from "three";

export type ShadowProxyShadowSide = "front" | "back" | "double";

export interface ShadowProxyConfig {
  enabled: boolean;
  gridRes: number;
  startM: number;
  endM: number;
  heightBiasM: number;
  minHeightM: number;
  maxHeightM: number;
  edgeFadeM: number;
  castShadow: boolean;
  receiveShadow: boolean;
  mainPassColorWrite: boolean;
  mainPassDepthWrite: boolean;
  shadowSide: ShadowProxyShadowSide;
  lightShadowMapSize: number;
  lightShadowCameraExtentM: number;
  lightShadowCameraNearM: number;
  lightShadowCameraFarM: number;
  lightShadowBias: number;
  lightShadowNormalBias: number;
  debugVisibleProxy: boolean;
  debugWireframe: boolean;
  debugFreezeProxy: boolean;
  debugShowBounds: boolean;
}

export interface ShadowProxyStats {
  enabled: boolean;
  built: boolean;
  gridRes: number;
  vertexCount: number;
  triangleCount: number;
  buildMs: number;
  worldMinX: number;
  worldMaxX: number;
  worldMinZ: number;
  worldMaxZ: number;
  minHeight: number;
  maxHeight: number;
  castShadow: boolean;
  receiveShadow: boolean;
  mainPassColorWrite: boolean;
  mainPassDepthWrite: boolean;
}

export interface ShadowProxyCoverage {
  centerX: number;
  centerZ: number;
  extentM: number;
}

/** Heightfield source for the far terrain shadow proxy. */
export type ShadowProxySource = import("../clod/terrain_summary.js").TerrainSummaryField;

export interface ShadowProxyRuntime {
  mesh: THREE.Mesh | null;
  stats: ShadowProxyStats;
  dispose(): void;
}

export interface LongViewSunShadowsConfig {
  enabled: boolean;
  shadowProxy: ShadowProxyConfig;
}
