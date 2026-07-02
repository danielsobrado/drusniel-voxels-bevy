import * as THREE from "three";
import type { PageFootprint } from "../types.js";

export function clampGrassFootprint(footprint: PageFootprint, worldCells: number): PageFootprint {
  return {
    minX: THREE.MathUtils.clamp(footprint.minX, 0, worldCells),
    minZ: THREE.MathUtils.clamp(footprint.minZ, 0, worldCells),
    maxX: THREE.MathUtils.clamp(footprint.maxX, 0, worldCells),
    maxZ: THREE.MathUtils.clamp(footprint.maxZ, 0, worldCells),
  };
}

export function grassFootprintCenterX(footprint: PageFootprint): number {
  return (footprint.minX + footprint.maxX) * 0.5;
}

export function grassFootprintCenterZ(footprint: PageFootprint): number {
  return (footprint.minZ + footprint.maxZ) * 0.5;
}

export function grassFootprintRadius(footprint: PageFootprint): number {
  return Math.hypot(footprint.maxX - footprint.minX, footprint.maxZ - footprint.minZ) * 0.5;
}
