import type * as THREE from "three";

export interface RainWeatherShaderHandle {
  material: THREE.Material;
  setTime(time: number): void;
  setIntensity(intensity: number): void;
  setCenter(center: THREE.Vector3): void;
  setWind(x: number, z: number): void;
  dispose(): void;
}
