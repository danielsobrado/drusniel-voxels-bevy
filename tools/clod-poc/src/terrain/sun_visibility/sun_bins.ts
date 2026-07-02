import * as THREE from "three";

export function toSunBin(v: THREE.Vector3, options: any) {
  const dir = v.clone().normalize();
  const a = THREE.MathUtils.euclideanModulo(THREE.MathUtils.radToDeg(Math.atan2(dir.z, dir.x)), 360);
  const e = Math.max(options.minElevationDegrees, THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1))));
  return {
    azimuthIndex: Math.floor(a / options.azimuthDegrees),
    elevationIndex: Math.floor(e / options.elevationDegrees),
  };
}

export function sunBinKey(bin: any): string {
  return `${bin.azimuthIndex}:${bin.elevationIndex}`;
}
