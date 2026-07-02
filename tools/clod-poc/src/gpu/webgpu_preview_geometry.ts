import * as THREE from "three";
import { PAINT_BLEND_CHANNELS, paintWeightsAt } from "../terrain/terrain.js";
import { biomeIdsFor } from "../terrain/geometry/page_geometry.js";
import type { ClodPageNode, PageMesh } from "../types.js";

interface PaintAttributeCache {
  slots: Float32Array;
  weights: Float32Array;
}

const paintAttributeCache = new WeakMap<PageMesh, PaintAttributeCache>();

function paintAttributesFor(mesh: PageMesh): PaintAttributeCache {
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

export function terrainGeometry(node: ClodPageNode): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(node.mesh.positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(node.mesh.normals, 3));
  const { slots: paintSlots, weights: paintWeights } = paintAttributesFor(node.mesh);
  g.setAttribute("paintSlots", new THREE.BufferAttribute(paintSlots, PAINT_BLEND_CHANNELS));
  g.setAttribute("paintWeights", new THREE.BufferAttribute(paintWeights, PAINT_BLEND_CHANNELS));
  g.setAttribute("biomeId", new THREE.BufferAttribute(biomeIdsFor(node.mesh), 1));
  g.setIndex(new THREE.BufferAttribute(node.mesh.indices, 1));
  return g;
}
