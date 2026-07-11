import type * as THREE from "three";
import type { WebGPURenderer } from "three/webgpu";
import type { TerrainFieldConfig } from "../terrain/terrain.js";
import type { FarSummaryGpuAtlasRingView, FarSummaryGpuAtlasView } from "../naadf/gpu/farSummaryAtlas.js";
import type { FarSummaryConfig } from "./config.js";
import type { StreamCenter } from "./stream-center.js";

export interface FarSummaryRenderAtlasTextureSet {
  height: GPUTexture;
  material: GPUTexture;
  normal: GPUTexture;
  coverage: GPUTexture;
}

export interface FarSummaryRenderAtlasFrontTextures {
  height: THREE.DataTexture;
  material: THREE.DataTexture;
  normal: THREE.DataTexture;
  coverage: THREE.DataTexture;
}

export interface FarSummaryGpuRenderAtlasTile {
  ring: number;
  tileX: number;
  tileZ: number;
  cellSizeM: number;
  tileCells: number;
  originX: number;
  originZ: number;
  sizeX: number;
  sizeZ: number;
  revision: number;
  atlasX: number;
  atlasY: number;
}

export interface FarSummaryGpuRenderAtlasPlan {
  signature: string;
  rings: FarSummaryGpuAtlasRingView[];
  tiles: FarSummaryGpuRenderAtlasTile[];
}

export interface FarSummaryGpuRenderAtlasRuntime {
  readonly view: FarSummaryGpuAtlasView;
  update(center: StreamCenter, frameIndex: number): void;
  dispose(): void;
}

export interface CreateFarSummaryGpuRenderAtlasOptions {
  renderer: WebGPURenderer;
  device: GPUDevice;
  config: FarSummaryConfig;
  terrainFieldConfig?: TerrainFieldConfig;
}

export interface FarSummaryRenderAtlasPipelineState {
  layout: GPUBindGroupLayout;
  pipeline: GPUComputePipeline;
}
