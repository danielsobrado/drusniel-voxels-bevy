import * as THREE from "three";
import { surfaceHeightCore } from "../gpu/terrain_field_core.js";

const MACRO_STEP = 16;

export function sampleMacroTerrainHeight(x: number, z: number): number {
  return surfaceHeightCore(x, z);
}

export function sampleMacroTerrainNormal(x: number, z: number): THREE.Vector3 {
  const h = (px: number, pz: number) => surfaceHeightCore(px, pz);
  const step = MACRO_STEP;
  const hL = h(x - step, z);
  const hR = h(x + step, z);
  const hD = h(x, z - step);
  const hU = h(x, z + step);

  if (!Number.isFinite(hL) || !Number.isFinite(hR) || !Number.isFinite(hD) || !Number.isFinite(hU)) {
    return new THREE.Vector3(0, 1, 0);
  }

  const nx = hL - hR;
  const ny = 2 * step;
  const nz = hD - hU;
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-10) return new THREE.Vector3(0, 1, 0);
  return new THREE.Vector3(nx / len, ny / len, nz / len);
}

export function sampleMacroTerrainMaterial(x: number, z: number): number {
  const h = surfaceHeightCore(x, z);
  const normal = sampleMacroTerrainNormal(x, z);
  const slope = Math.acos(Math.max(0, Math.min(1, normal.y)));

  if (h > 96) return 3;
  if (h > 72) return 2;
  if (slope > 0.6) return 2;
  if (h > 40) return 1;
  return 0;
}
