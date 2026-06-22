import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  Fn,
  cos,
  float,
  floor,
  fract,
  hash,
  instancedArray,
  instanceIndex,
  mix,
  positionLocal,
  sin,
  uniform,
  varying,
  vec3,
  vec4,
} from "three/tsl";
import type { WebGPURenderer } from "three/webgpu";

interface Phase0StorageInstances {
  mesh: THREE.InstancedMesh;
  count: number;
}

export async function createPhase0StorageInstances(
  renderer: WebGPURenderer,
  count: number,
  seed: number,
): Promise<Phase0StorageInstances> {
  const offsets = instancedArray(count, "vec4");
  const colors = instancedArray(count, "vec4");
  const seedU = uniform(seed % 100000);

  const fill = Fn(() => {
    const i = instanceIndex;
    const fi = float(i);
    const ring = floor(fi.div(96));
    const turn = fract(fi.div(96)).mul(Math.PI * 2);
    const h1 = hash(i.add(seedU));
    const h2 = hash(i.add(seedU).add(1499));
    const h3 = hash(i.add(seedU).add(9157));
    const angle = turn.add(ring.mul(0.57));
    const radius = ring.mul(1.55).add(4.0).add(h1.mul(1.2));
    const scale = h2.mul(h2).mul(0.65).add(0.18);
    offsets.element(i).assign(vec4(cos(angle).mul(radius), h1.mul(1.7).add(0.1), sin(angle).mul(radius), scale));
    colors.element(i).assign(vec4(mix(vec3(0.18, 0.42, 0.34), vec3(0.8, 0.54, 0.24), h3), 1));
  })().compute(count);

  await renderer.computeAsync(fill);

  const geometry = new THREE.IcosahedronGeometry(1, 1);
  geometry.scale(0.75, 1.4, 0.75);
  geometry.translate(0, 1.1, 0);

  const material = new MeshBasicNodeMaterial();
  const instanceOffset = offsets.element(instanceIndex);
  material.positionNode = positionLocal.mul(instanceOffset.w).add(instanceOffset.xyz);
  material.colorNode = varying(colors.element(instanceIndex));

  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = "phase0-storage-instances";
  mesh.frustumCulled = false;
  mesh.position.set(0, 0, 0);
  return { mesh, count };
}
