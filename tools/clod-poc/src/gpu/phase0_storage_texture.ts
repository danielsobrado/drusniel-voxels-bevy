import { DoubleSide, Mesh } from "three";
import { MeshBasicNodeMaterial, StorageTexture } from "three/webgpu";
import type { WebGPURenderer } from "three/webgpu";
import {
  Fn,
  float,
  floor,
  hash,
  instanceIndex,
  mix,
  texture,
  textureStore,
  uniform,
  uv,
  uvec2,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { PlaneGeometry } from "three";

export async function createPhase0StorageTexture(
  renderer: WebGPURenderer,
  size: number,
  seed: number,
): Promise<StorageTexture> {
  const storageTexture = new StorageTexture(size, size);
  const seedU = uniform(seed % 100000);
  const writeTexture = Fn(() => {
    const i = instanceIndex;
    const x = i.mod(size);
    const y = i.div(size);
    const p = vec2(float(x), float(y)).div(size);
    const tile = hash(floor(p.x.mul(12)).add(floor(p.y.mul(12)).mul(57)).add(seedU));
    const n = hash(x.add(y.mul(size)).add(seedU));
    const moss = vec3(0.13, 0.36, 0.28);
    const ember = vec3(0.82, 0.44, 0.18);
    const base = mix(moss, ember, n);
    const color = base.mul(tile.mul(0.55).add(0.7));
    textureStore(storageTexture, uvec2(x, y), vec4(color, 1)).toWriteOnly();
  })().compute(size * size);

  await renderer.computeAsync(writeTexture);
  return storageTexture;
}

export function createPhase0StorageTexturePanel(storageTexture: StorageTexture): Mesh {
  const material = new MeshBasicNodeMaterial();
  material.colorNode = texture(storageTexture, uv());
  material.side = DoubleSide;
  const mesh = new Mesh(new PlaneGeometry(13, 13), material);
  mesh.name = "phase0-storage-texture-panel";
  mesh.position.set(-18, 8, -10);
  mesh.rotation.y = Math.PI * 0.2;
  return mesh;
}
