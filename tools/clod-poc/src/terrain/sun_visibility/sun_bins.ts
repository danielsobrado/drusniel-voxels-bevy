import * as THREE from "three";

export interface SunDirectionBin {
  azimuthIndex: number;
  elevationIndex: number;
}

export interface SunDirectionBinConfig {
  azimuthDegrees: number;
  elevationDegrees: number;
  minElevationDegrees: number;
}

export function toSunBin(v: THREE.Vector3, options: SunDirectionBinConfig): SunDirectionBin {
  const dir = v.clone().normalize();
  const a = THREE.MathUtils.euclideanModulo(THREE.MathUtils.radToDeg(Math.atan2(dir.z, dir.x)), 360);
  const e = Math.max(options.minElevationDegrees, THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1))));
  return {
    azimuthIndex: Math.floor(a / options.azimuthDegrees),
    elevationIndex: Math.floor(e / options.elevationDegrees),
  };
}

export function sunBinKey(bin: SunDirectionBin): string {
  return `${bin.azimuthIndex}:${bin.elevationIndex}`;
}
