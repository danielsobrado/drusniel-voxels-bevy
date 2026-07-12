import * as THREE from "three";
import { getTerrainFieldConfig, PAINT_BLEND_CHANNELS, paintWeightsAt } from "../../terrain/terrain.js";
import type { PageMesh } from "../../types.js";
import type { ChunkMesh } from "../../gpu/gpu_chunk_mesher.js";
import { BiomeRegionField } from "../../world_source/biome_region_field.js";
import { ROOT_HEIGHT_MORPH_ATTRIBUTE } from "../streaming/root_height_morph.js";

type MeshLike = PageMesh | ChunkMesh;

export interface PaintAttributeCache {
  slots: Float32Array;
  weights: Float32Array;
}

const paintAttributeCache = new WeakMap<MeshLike, PaintAttributeCache>();
const biomeAttributeCache = new WeakMap<MeshLike, Float32Array>();

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

export function biomeIdsFor(mesh: MeshLike): Float32Array {
  const cached = biomeAttributeCache.get(mesh);
  if (cached) return cached;
  const terrain = getTerrainFieldConfig();
  const field = new BiomeRegionField({
    seed: terrain.seed,
    seaLevel: terrain.seaLevel,
    islandShape: terrain.islandShape,
  });
  const vertexCount = mesh.positions.length / 3;
  const biomeIds = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    const x = mesh.positions[i * 3];
    const y = mesh.positions[i * 3 + 1];
    const z = mesh.positions[i * 3 + 2];
    biomeIds[i] = field.sample(x, z, y).biome;
  }
  biomeAttributeCache.set(mesh, biomeIds);
  return biomeIds;
}

interface AttributePrimeState {
  cursor: number;
  slots: Float32Array;
  weights: Float32Array;
  biomeIds: Float32Array;
  field: BiomeRegionField;
}

const attributePrimeStates = new WeakMap<MeshLike, AttributePrimeState>();

/** True once the paint and biome attribute caches for `mesh` are populated. */
export function pageAttributesPrimed(mesh: MeshLike): boolean {
  return paintAttributeCache.has(mesh) && biomeAttributeCache.has(mesh);
}

/**
 * Resumable, deadline-bounded version of paintAttributesFor + biomeIdsFor. Both do real
 * per-vertex work (terrain paint lookups, biome noise sampling) — 34-68ms for a large
 * page when they run synchronously inside view creation at a root switch. Pre-warm calls
 * this a slice at a time ahead of the switch; when it completes, toGeometry's caches are
 * seeded and view creation pays nothing. Returns true when the mesh is fully primed.
 * A mesh that reaches toGeometry unprimed just falls back to the synchronous path.
 */
export function primePageAttributesBudgeted(mesh: MeshLike, deadlineMs: number): boolean {
  if (pageAttributesPrimed(mesh)) return true;
  let state = attributePrimeStates.get(mesh);
  if (!state) {
    const terrain = getTerrainFieldConfig();
    const vertexCount = mesh.positions.length / 3;
    state = {
      cursor: 0,
      slots: new Float32Array(vertexCount * PAINT_BLEND_CHANNELS),
      weights: new Float32Array(vertexCount * PAINT_BLEND_CHANNELS),
      biomeIds: new Float32Array(vertexCount),
      field: new BiomeRegionField({
        seed: terrain.seed,
        seaLevel: terrain.seaLevel,
        islandShape: terrain.islandShape,
      }),
    };
    attributePrimeStates.set(mesh, state);
  }
  const vertexCount = mesh.positions.length / 3;
  // Deadline checks per vertex would dominate the loop; a stride of 2048 vertices keeps
  // overshoot below ~1ms while amortising the clock reads.
  const CHECK_STRIDE = 2048;
  while (state.cursor < vertexCount) {
    const sliceEnd = Math.min(vertexCount, state.cursor + CHECK_STRIDE);
    for (let i = state.cursor; i < sliceEnd; i++) {
      const x = mesh.positions[i * 3];
      const y = mesh.positions[i * 3 + 1];
      const z = mesh.positions[i * 3 + 2];
      const p = paintWeightsAt(x, y, z);
      for (let c = 0; c < PAINT_BLEND_CHANNELS; c++) {
        state.slots[i * PAINT_BLEND_CHANNELS + c] = p.slots[c];
        state.weights[i * PAINT_BLEND_CHANNELS + c] = p.weights[c];
      }
      state.biomeIds[i] = state.field.sample(x, z, y).biome;
    }
    state.cursor = sliceEnd;
    if (performance.now() >= deadlineMs) break;
  }
  if (state.cursor < vertexCount) return false;
  paintAttributeCache.set(mesh, { slots: state.slots, weights: state.weights });
  biomeAttributeCache.set(mesh, state.biomeIds);
  attributePrimeStates.delete(mesh);
  return true;
}

export function toGeometry(mesh: MeshLike): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const vertexCount = mesh.positions.length / 3;
  g.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  g.setAttribute(ROOT_HEIGHT_MORPH_ATTRIBUTE, new THREE.BufferAttribute(new Float32Array(vertexCount), 1));
  const { slots: paintSlots, weights: paintWeights } = paintAttributesFor(mesh);
  g.setAttribute("paintSlots", new THREE.BufferAttribute(paintSlots, PAINT_BLEND_CHANNELS));
  g.setAttribute("paintWeights", new THREE.BufferAttribute(paintWeights, PAINT_BLEND_CHANNELS));
  g.setAttribute("biomeId", new THREE.BufferAttribute(biomeIdsFor(mesh), 1));
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
