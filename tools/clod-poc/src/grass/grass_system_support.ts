import * as THREE from "three";
import type {
  GrassGpuRingCompute,
  GrassGpuRingOutputBuffers,
} from "../gpu/grass_ring_compute.js";
import type { ResolvedDigEdit } from "../gpu/terrain_field_core.js";
import type { GrassRingSettings, GrassTier } from "./grass_config.js";

export type GrassGpuRingComputeFactory = (
  device: GPUDevice,
  edits: readonly ResolvedDigEdit[],
  outputBuffers: GrassGpuRingOutputBuffers | null,
  ring: GrassRingSettings,
) => Promise<GrassGpuRingCompute>;

export interface GrassPatch {
  nodeId: string;
  meshes: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>[];
  centerX: number;
  centerZ: number;
  radius: number;
  bladeCount: number;
  midBladeCount: number;
  visibleTier: "hidden" | GrassTier;
}

export function grassThinnedInstanceCount(instanceCount: number, thinRatio: number): number {
  if (instanceCount <= 0) return 0;
  const clamped = THREE.MathUtils.clamp(thinRatio, 0, 1);
  if (clamped <= 0) return 0;
  return Math.max(1, Math.floor(instanceCount * clamped));
}
