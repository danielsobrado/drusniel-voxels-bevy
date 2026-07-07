import * as THREE from "three";
import type { ClodPageNode } from "../../types.js";

export const ROOT_HEIGHT_MORPH_ATTRIBUTE = "rootMorphDeltaY";

export interface RootHeightMorphView {
  node: Pick<ClodPageNode, "id" | "revision" | "mesh" | "rootTransition">;
  mesh: THREE.Mesh;
}

export interface RootHeightMorphStats {
  builtRoots: number;
  builtVertices: number;
  buildMs: number;
}

interface HeightVertex {
  x: number;
  y: number;
  z: number;
}

interface HeightTriangle {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  cx: number;
  cy: number;
  cz: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface HeightSampler {
  sample(x: number, z: number): number | null;
}

const HEIGHT_MORPH_BIN_SIZE_M = 32;
const HEIGHT_MORPH_MAX_SEARCH_BINS = 2;
const HEIGHT_MORPH_MAX_DELTA_M = 128;
const HEIGHT_MORPH_EPSILON = 1e-4;
const HEIGHT_MORPH_SIGNATURE_KEY = "rootHeightMorphSignature";
const HEIGHT_SAMPLER_CACHE_LIMIT = 64;

const heightSamplerCache = new Map<string, HeightSampler>();

function binKey(ix: number, iz: number): string {
  return `${ix},${iz}`;
}

function clampDelta(delta: number): number {
  if (!Number.isFinite(delta)) return 0;
  return THREE.MathUtils.clamp(delta, -HEIGHT_MORPH_MAX_DELTA_M, HEIGHT_MORPH_MAX_DELTA_M);
}

function triangleHeightAt(tri: HeightTriangle, x: number, z: number): number | null {
  const den = (tri.bz - tri.cz) * (tri.ax - tri.cx) + (tri.cx - tri.bx) * (tri.az - tri.cz);
  if (Math.abs(den) <= HEIGHT_MORPH_EPSILON) return null;
  const u = ((tri.bz - tri.cz) * (x - tri.cx) + (tri.cx - tri.bx) * (z - tri.cz)) / den;
  const v = ((tri.cz - tri.az) * (x - tri.cx) + (tri.ax - tri.cx) * (z - tri.cz)) / den;
  const w = 1 - u - v;
  const slack = -0.001;
  if (u < slack || v < slack || w < slack) return null;
  return u * tri.ay + v * tri.by + w * tri.cy;
}

function makeTriangle(vertices: Float32Array, indices: Uint32Array, triOffset: number): HeightTriangle | null {
  const ia = indices[triOffset] * 3;
  const ib = indices[triOffset + 1] * 3;
  const ic = indices[triOffset + 2] * 3;
  const ax = vertices[ia];
  const ay = vertices[ia + 1];
  const az = vertices[ia + 2];
  const bx = vertices[ib];
  const by = vertices[ib + 1];
  const bz = vertices[ib + 2];
  const cx = vertices[ic];
  const cy = vertices[ic + 1];
  const cz = vertices[ic + 2];
  if (![ax, ay, az, bx, by, bz, cx, cy, cz].every(Number.isFinite)) return null;
  return {
    ax, ay, az,
    bx, by, bz,
    cx, cy, cz,
    minX: Math.min(ax, bx, cx),
    maxX: Math.max(ax, bx, cx),
    minZ: Math.min(az, bz, cz),
    maxZ: Math.max(az, bz, cz),
  };
}

function buildHeightSampler(sourceViews: readonly RootHeightMorphView[]): HeightSampler {
  const bins = new Map<string, HeightTriangle[]>();
  const fallbackVertices: HeightVertex[] = [];

  for (const view of sourceViews) {
    const positions = view.node.mesh.positions;
    const indices = view.node.mesh.indices;
    for (let i = 0; i < positions.length; i += 3) {
      fallbackVertices.push({ x: positions[i], y: positions[i + 1], z: positions[i + 2] });
    }
    for (let i = 0; i < indices.length; i += 3) {
      const tri = makeTriangle(positions, indices, i);
      if (!tri) continue;
      const minX = Math.floor(tri.minX / HEIGHT_MORPH_BIN_SIZE_M);
      const maxX = Math.floor(tri.maxX / HEIGHT_MORPH_BIN_SIZE_M);
      const minZ = Math.floor(tri.minZ / HEIGHT_MORPH_BIN_SIZE_M);
      const maxZ = Math.floor(tri.maxZ / HEIGHT_MORPH_BIN_SIZE_M);
      for (let iz = minZ; iz <= maxZ; iz++) {
        for (let ix = minX; ix <= maxX; ix++) {
          const key = binKey(ix, iz);
          const bucket = bins.get(key);
          if (bucket) bucket.push(tri);
          else bins.set(key, [tri]);
        }
      }
    }
  }

  const sampleFromBins = (ix: number, iz: number, x: number, z: number): number | null => {
    const candidates = bins.get(binKey(ix, iz));
    if (!candidates) return null;
    for (const tri of candidates) {
      if (x < tri.minX - 0.001 || x > tri.maxX + 0.001 || z < tri.minZ - 0.001 || z > tri.maxZ + 0.001) continue;
      const y = triangleHeightAt(tri, x, z);
      if (y !== null) return y;
    }
    return null;
  };

  const sampleFallback = (x: number, z: number): number | null => {
    let best: HeightVertex | null = null;
    let bestD2 = Number.POSITIVE_INFINITY;
    for (const v of fallbackVertices) {
      const dx = x - v.x;
      const dz = z - v.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = v;
      }
    }
    return best?.y ?? null;
  };

  return {
    sample(x, z) {
      const ix = Math.floor(x / HEIGHT_MORPH_BIN_SIZE_M);
      const iz = Math.floor(z / HEIGHT_MORPH_BIN_SIZE_M);
      const direct = sampleFromBins(ix, iz, x, z);
      if (direct !== null) return direct;
      for (let radius = 1; radius <= HEIGHT_MORPH_MAX_SEARCH_BINS; radius++) {
        for (let dz = -radius; dz <= radius; dz++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;
            const y = sampleFromBins(ix + dx, iz + dz, x, z);
            if (y !== null) return y;
          }
        }
      }
      return sampleFallback(x, z);
    },
  };
}

function meshSignature(view: RootHeightMorphView): string {
  const mesh = view.node.mesh;
  return [view.node.id, view.node.revision ?? 0, mesh.positions.length, mesh.indices.length].join(":");
}

function sourceSignature(sourceViews: readonly RootHeightMorphView[]): string {
  return sourceViews.map(meshSignature).sort().join("|");
}

function morphSignature(view: RootHeightMorphView, sourceViews: readonly RootHeightMorphView[]): string {
  const transition = view.node.rootTransition;
  return [
    transition?.groupId ?? 0,
    transition?.mode ?? "stable",
    meshSignature(view),
    sourceSignature(sourceViews),
  ].join("|");
}

function cachedHeightSampler(sourceViews: readonly RootHeightMorphView[]): HeightSampler {
  const signature = sourceSignature(sourceViews);
  const cached = heightSamplerCache.get(signature);
  if (cached) return cached;
  const sampler = buildHeightSampler(sourceViews);
  heightSamplerCache.set(signature, sampler);
  if (heightSamplerCache.size > HEIGHT_SAMPLER_CACHE_LIMIT) {
    const oldestKey = heightSamplerCache.keys().next().value;
    if (oldestKey !== undefined) heightSamplerCache.delete(oldestKey);
  }
  return sampler;
}

function ensureRootMorphAttribute(geometry: THREE.BufferGeometry, vertexCount: number): THREE.BufferAttribute {
  const existing = geometry.getAttribute(ROOT_HEIGHT_MORPH_ATTRIBUTE) as THREE.BufferAttribute | undefined;
  if (existing && existing.array.length === vertexCount) return existing;
  const attribute = new THREE.BufferAttribute(new Float32Array(vertexCount), 1);
  geometry.setAttribute(ROOT_HEIGHT_MORPH_ATTRIBUTE, attribute);
  return attribute;
}

function writeMorphDeltaAttribute(view: RootHeightMorphView, deltaY: Float32Array): void {
  const geometry = view.mesh.geometry as THREE.BufferGeometry;
  const attribute = ensureRootMorphAttribute(geometry, deltaY.length);
  (attribute.array as Float32Array).set(deltaY);
  attribute.needsUpdate = true;
}

function buildDeltaY(view: RootHeightMorphView, sourceViews: readonly RootHeightMorphView[]): Float32Array {
  const sampler = cachedHeightSampler(sourceViews);
  const positions = view.node.mesh.positions;
  const deltas = new Float32Array(positions.length / 3);
  for (let i = 0; i < deltas.length; i++) {
    const p = i * 3;
    const sourceY = sampler.sample(positions[p], positions[p + 2]);
    deltas[i] = sourceY === null ? 0 : clampDelta(sourceY - positions[p + 1]);
  }
  return deltas;
}

export function applyRootHeightMorph(
  view: RootHeightMorphView,
  sourceViews: readonly RootHeightMorphView[],
): RootHeightMorphStats {
  if (sourceViews.length === 0) {
    resetRootHeightMorph(view);
    return { builtRoots: 0, builtVertices: 0, buildMs: 0 };
  }

  const geometry = view.mesh.geometry as THREE.BufferGeometry;
  const signature = morphSignature(view, sourceViews);
  const startedAt = performance.now();
  let builtRoots = 0;
  let builtVertices = 0;
  if (geometry.userData[HEIGHT_MORPH_SIGNATURE_KEY] !== signature) {
    const deltas = buildDeltaY(view, sourceViews);
    writeMorphDeltaAttribute(view, deltas);
    geometry.userData[HEIGHT_MORPH_SIGNATURE_KEY] = signature;
    builtRoots = 1;
    builtVertices = deltas.length;
  }
  if (view.node.rootTransition) view.node.rootTransition.parentHeightMorphReady = true;

  return { builtRoots, builtVertices, buildMs: performance.now() - startedAt };
}

export function resetRootHeightMorph(view: RootHeightMorphView): void {
  const geometry = view.mesh.geometry as THREE.BufferGeometry;
  if (view.node.rootTransition) view.node.rootTransition.parentHeightMorphReady = false;
  if (geometry.userData[HEIGHT_MORPH_SIGNATURE_KEY] === undefined) return;
  const attribute = geometry.getAttribute(ROOT_HEIGHT_MORPH_ATTRIBUTE) as THREE.BufferAttribute | undefined;
  if (!attribute) return;
  (attribute.array as Float32Array).fill(0);
  attribute.needsUpdate = true;
  delete geometry.userData[HEIGHT_MORPH_SIGNATURE_KEY];
}
