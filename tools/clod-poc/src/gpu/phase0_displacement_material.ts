import { MeshStandardNodeMaterial } from "three/webgpu";
import {
  cos,
  float,
  mix,
  positionLocal,
  sin,
  texture,
  uniform,
  uv,
  vec3,
} from "three/tsl";
import type { StorageTexture } from "three/webgpu";

export function createPhase0DisplacementMaterial(storageTexture: StorageTexture, seed: number): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  const seedU = uniform((seed % 8192) / 8192);
  const wave = sin(positionLocal.x.mul(0.24).add(seedU.mul(6.283)))
    .mul(cos(positionLocal.z.mul(0.19).add(seedU.mul(11.0))))
    .mul(1.8);
  material.positionNode = positionLocal.add(vec3(0, wave, 0));
  material.colorNode = mix(vec3(0.16, 0.3, 0.42), texture(storageTexture, uv().mul(3).fract()).rgb, 0.72);
  material.roughnessNode = float(0.86);
  return material;
}
