import * as THREE from "three";
import { MeshoptSimplifier } from "meshoptimizer";

let ready = false;

export async function initPropSimplifier(): Promise<void> {
  if (ready) return;
  await MeshoptSimplifier.ready;
  (MeshoptSimplifier as unknown as { useExperimentalFeatures?: boolean }).useExperimentalFeatures = true;
  ready = true;
}

export interface PropMeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export interface PropSimplifyResult extends PropMeshData {
  resultError: number;
  errorWorld: number;
  scale: number;
}

function compactPropMesh(mesh: PropMeshData, indices: Uint32Array): PropMeshData {
  const remap = new Map<number, number>();
  const positions: number[] = [];
  const normals: number[] = [];
  const out = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    const old = indices[i]!;
    let ni = remap.get(old);
    if (ni === undefined) {
      ni = positions.length / 3;
      remap.set(old, ni);
      positions.push(
        mesh.positions[old * 3]!,
        mesh.positions[old * 3 + 1]!,
        mesh.positions[old * 3 + 2]!,
      );
      normals.push(mesh.normals[old * 3]!, mesh.normals[old * 3 + 1]!, mesh.normals[old * 3 + 2]!);
    }
    out[i] = ni;
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: out,
  };
}

export function bufferGeometryToPropMesh(geometry: THREE.BufferGeometry): PropMeshData {
  const posAttr = geometry.getAttribute("position");
  if (!posAttr) throw new Error("Prop mesh missing position attribute");
  const norAttr = geometry.getAttribute("normal");
  if (!norAttr) throw new Error("Prop mesh missing normal attribute");

  const positions = new Float32Array(posAttr.array as ArrayLike<number>);
  const normals = new Float32Array(norAttr.array as ArrayLike<number>);
  let indices: Uint32Array;
  if (geometry.index) {
    indices = new Uint32Array(geometry.index.array as ArrayLike<number>);
  } else {
    indices = new Uint32Array(posAttr.count);
    for (let i = 0; i < posAttr.count; i++) indices[i] = i;
  }
  return { positions, normals, indices };
}

export function propMeshToBufferGeometry(mesh: PropMeshData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  return geometry;
}

export function simplifyPropMesh(
  mesh: PropMeshData,
  targetRatio: number,
  targetError = 0.01,
): PropSimplifyResult {
  if (!ready) throw new Error("call initPropSimplifier() first");
  const vc = mesh.positions.length / 3;
  const inputIndices = mesh.indices.length;
  const targetRaw = Math.floor(inputIndices * targetRatio);
  const targetIndices = Math.min(inputIndices, Math.max(3, Math.floor(targetRaw / 3) * 3));

  const locks = new Uint8Array(vc);
  const scale = MeshoptSimplifier.getScale(mesh.positions, 3);
  const attrs = new Float32Array(vc * 3);
  for (let i = 0; i < vc; i++) {
    attrs[i * 3 + 0] = mesh.normals[i * 3 + 0]!;
    attrs[i * 3 + 1] = mesh.normals[i * 3 + 1]!;
    attrs[i * 3 + 2] = mesh.normals[i * 3 + 2]!;
  }
  const [outIndices, resultError] = MeshoptSimplifier.simplifyWithAttributes(
    mesh.indices,
    mesh.positions,
    3,
    attrs,
    3,
    [1, 1, 1],
    locks,
    targetIndices,
    targetError,
    [],
  );

  const compacted = compactPropMesh(mesh, outIndices);
  return {
    ...compacted,
    resultError,
    errorWorld: resultError * scale,
    scale,
  };
}

export function propTriangleCount(mesh: PropMeshData): number {
  return mesh.indices.length / 3;
}
