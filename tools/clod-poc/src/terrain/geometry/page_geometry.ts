import * as THREE from "three";
import { PAINT_BLEND_CHANNELS, paintWeightsAt } from "../../terrain/terrain.js";
import type { PageMesh } from "../../types.js";
import type { ChunkMesh } from "../../gpu/gpu_chunk_mesher.js";

type MeshLike = PageMesh | ChunkMesh;

export interface PaintAttributeCache {
  slots: Float32Array;
  weights: Float32Array;
}

const paintAttributeCache = new WeakMap<MeshLike, PaintAttributeCache>();

export function paintAttributesFor(mesh: MeshLike): PaintAttributeCache {
  const cached = paintAttributeCache.get(mesh);
  if (cached) return cached;
  const vertexCount = mesh.positions.length / 3;
  const slots = new Float32Array(vertexCount * PAINT_BLEND_CHANNELS);
  const weights = new Float32Array(vertexCount * PAINT_BLEND_CHANNELS);
  for (let i = 0; i < vertexCount; i++) {
    const p = paintWeightsAt(mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]);
    for (let c = 0; c < PAINT_BLEND_CHANNELS; c++) {
      slots[i * PAINT_BLEND_CHANNELS + c] = p.slots[c];
      weights[i * PAINT_BLEND_CHANNELS + c] = p.weights[c];
    }
  }
  const built = { slots, weights };
  paintAttributeCache.set(mesh, built);
  return built;
}

export function toGeometry(mesh: MeshLike): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  const { slots: paintSlots, weights: paintWeights } = paintAttributesFor(mesh);
  g.setAttribute("paintSlots", new THREE.BufferAttribute(paintSlots, PAINT_BLEND_CHANNELS));
  g.setAttribute("paintWeights", new THREE.BufferAttribute(paintWeights, PAINT_BLEND_CHANNELS));
  g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  return g;
}

export function computeGeometryNormals(mesh: PageMesh): Float32Array {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  g.computeVertexNormals();
  const normals = (g.getAttribute("normal").array as Float32Array).slice();
  g.dispose();
  return normals;
}
