import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  cos,
  instanceIndex,
  positionGeometry,
  sin,
  storage,
  vec3,
} from "three/tsl";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

export interface PropGpuRingInstanceBuffers {
  instanceA: THREE.BufferAttribute;
  instanceB: THREE.BufferAttribute;
  capacity: number;
}

export function createPropGpuRingMaterial(
  source: THREE.Material,
  buffers: PropGpuRingInstanceBuffers,
): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  const sourceWithColor = source as THREE.Material & { color?: THREE.Color; map?: THREE.Texture | null; alphaMap?: THREE.Texture | null };
  if (sourceWithColor.color) material.color.copy(sourceWithColor.color);
  if (sourceWithColor.map) material.map = sourceWithColor.map;
  if (sourceWithColor.alphaMap) material.alphaMap = sourceWithColor.alphaMap;
  material.transparent = source.transparent;
  material.opacity = source.opacity;
  material.alphaTest = source.alphaTest;
  material.side = source.side;
  material.depthWrite = source.depthWrite;
  material.depthTest = source.depthTest;

  const instanceAStore: TslNode = storage(buffers.instanceA, "vec4", buffers.capacity).toReadOnly();
  const instanceBStore: TslNode = storage(buffers.instanceB, "vec4", buffers.capacity).toReadOnly();
  const instA: TslNode = instanceAStore.element(instanceIndex);
  const instB: TslNode = instanceBStore.element(instanceIndex);
  const local: TslNode = positionGeometry.mul(instA.w);
  const c: TslNode = cos(instB.x);
  const s: TslNode = sin(instB.x);
  const rx: TslNode = c.mul(local.x).add(s.mul(local.z));
  const rz: TslNode = s.mul(local.x).negate().add(c.mul(local.z));
  material.positionNode = vec3(rx.add(instA.x), local.y.add(instA.y), rz.add(instA.z));
  return material;
}
