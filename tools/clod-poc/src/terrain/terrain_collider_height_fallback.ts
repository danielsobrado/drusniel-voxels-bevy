import type * as THREE from "three";
import type { TerrainHeightFallback } from "./terrain_collider.js";

/** The fallback column is certified single-surface (absent certifier = certified). */
export function columnCertifiedForFallback(
  heightFallback: TerrainHeightFallback | null | undefined,
  x: number,
  z: number,
): boolean {
  return heightFallback?.certifyColumn?.(x, z) ?? true;
}

export function applyHeightFallback(
  heightFallback: TerrainHeightFallback | null | undefined,
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  grounded: boolean,
): {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  grounded: boolean;
  fired: boolean;
  deniedUncertified: boolean;
} {
  if (grounded || !heightFallback?.enabled) {
    return { position, velocity, grounded, fired: false, deniedUncertified: false };
  }
  const terrainY = heightFallback.surfaceHeight(position.x, position.z);
  if (!Number.isFinite(terrainY) || position.y > terrainY) {
    return { position, velocity, grounded, fired: false, deniedUncertified: false };
  }
  if (!columnCertifiedForFallback(heightFallback, position.x, position.z)) {
    return { position, velocity, grounded, fired: false, deniedUncertified: true };
  }
  const resolvedPosition = position.clone();
  resolvedPosition.y = terrainY;
  const resolvedVelocity = velocity.clone();
  if (resolvedVelocity.y < 0) resolvedVelocity.y = 0;
  return {
    position: resolvedPosition,
    velocity: resolvedVelocity,
    grounded: true,
    fired: true,
    deniedUncertified: false,
  };
}
