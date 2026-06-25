import * as THREE from "three";

export interface StreamCenter {
  worldX: number;
  worldZ: number;
  predictedX: number;
  predictedZ: number;
  velocityX: number;
  velocityZ: number;
}

const MAX_VELOCITY_MPS = 500;
const VELOCITY_DECAY = 0.85;

export function updateStreamCenter(
  cameraPosition: THREE.Vector3,
  previousCenter: StreamCenter | null,
  deltaSeconds: number,
  preloadSeconds: number,
): StreamCenter {
  const wx = cameraPosition.x;
  const wz = cameraPosition.z;

  let vx = 0;
  let vz = 0;

  if (previousCenter && deltaSeconds > 0.001) {
    const rawVx = (wx - previousCenter.worldX) / deltaSeconds;
    const rawVz = (wz - previousCenter.worldZ) / deltaSeconds;

    vx = previousCenter.velocityX * VELOCITY_DECAY + rawVx * (1 - VELOCITY_DECAY);
    vz = previousCenter.velocityZ * VELOCITY_DECAY + rawVz * (1 - VELOCITY_DECAY);

    const speed = Math.hypot(vx, vz);
    if (speed > MAX_VELOCITY_MPS) {
      const scale = MAX_VELOCITY_MPS / speed;
      vx *= scale;
      vz *= scale;
    }
  }

  return {
    worldX: wx,
    worldZ: wz,
    predictedX: wx + vx * preloadSeconds,
    predictedZ: wz + vz * preloadSeconds,
    velocityX: vx,
    velocityZ: vz,
  };
}
