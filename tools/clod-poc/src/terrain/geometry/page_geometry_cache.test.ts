import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { ClodPageNode, PageMesh } from "../../types.js";
import { PageGeometryCache } from "./page_geometry_cache.js";

function mesh(seed = 0): PageMesh {
  return {
    positions: new Float32Array([
      seed, 0, 0,
      seed + 1, 0, 0,
      seed, 0, 1,
    ]),
    normals: new Float32Array([
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
    ]),
    paintSlots: new Float32Array([0, 0, 0]),
    materialWeights: new Float32Array([
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0,
    ]),
    materialWeightStride: 4,
    indices: new Uint32Array([0, 1, 2]),
  };
}

function node(id = "L0:0,0", pageMesh = mesh(), revision = 1): ClodPageNode {
  return {
    id,
    revision,
    level: 0,
    children: [],
    mesh: pageMesh,
    footprint: { minX: 0, minZ: 0, maxX: 1, maxZ: 1 },
    bounds: { center: [0, 0, 0], radius: 1, minY: 0, maxY: 1 },
    errorWorld: 0,
    lowBenefit: false,
  };
}

function geometry(indexed = false): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
  if (indexed) g.setIndex(new THREE.BufferAttribute(new Uint32Array([0, 1, 2]), 1));
  return g;
}

describe("PageGeometryCache", () => {
  it("reuses geometry for the same node mesh revision and normal mode", () => {
    const cache = new PageGeometryCache({ enabled: true, maxEntries: 8, warnAtEntries: 8 });
    const n = node();
    const createGeometry = vi.fn(geometry);

    const first = cache.getOrCreate({ node: n, normalMode: "source", createGeometry });
    const second = cache.getOrCreate({ node: n, normalMode: "source", createGeometry });

    expect(second).toBe(first);
    expect(createGeometry).toHaveBeenCalledTimes(1);
    expect(cache.stats()).toMatchObject({ hits: 1, misses: 1, entries: 1 });
    cache.dispose();
  });

  it("keeps source and recomputed normal modes in separate entries", () => {
    const cache = new PageGeometryCache({ enabled: true, maxEntries: 8, warnAtEntries: 8 });
    const n = node();
    const source = cache.getOrCreate({ node: n, normalMode: "source", createGeometry: geometry });
    const recomputed = cache.getOrCreate({ node: n, normalMode: "recomputed", createGeometry: geometry });

    expect(recomputed).not.toBe(source);
    expect(cache.stats().entries).toBe(2);
    cache.dispose();
  });

  it("uses node revision in the cache key", () => {
    const cache = new PageGeometryCache({ enabled: true, maxEntries: 8, warnAtEntries: 8 });
    const first = cache.getOrCreate({ node: node("L0:0,0", mesh(), 1), normalMode: "source", createGeometry: geometry });
    const second = cache.getOrCreate({ node: node("L0:0,0", mesh(), 2), normalMode: "source", createGeometry: geometry });

    expect(second).not.toBe(first);
    expect(cache.stats()).toMatchObject({ entries: 2, misses: 2 });
    cache.dispose();
  });

  it("invalidates a node and disposes inactive cached geometry", () => {
    const cache = new PageGeometryCache({ enabled: true, maxEntries: 8, warnAtEntries: 8 });
    const n = node();
    const first = geometry();
    const dispose = vi.spyOn(first, "dispose");

    expect(cache.getOrCreate({ node: n, normalMode: "source", createGeometry: () => first })).toBe(first);
    cache.invalidateNode(n.id);

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(cache.stats()).toMatchObject({ entries: 0, invalidations: 1, disposals: 1 });
  });

  it("defers invalidating active geometry until the view releases it", () => {
    const cache = new PageGeometryCache({ enabled: true, maxEntries: 8, warnAtEntries: 8 });
    const n = node();
    const first = geometry();
    const dispose = vi.spyOn(first, "dispose");

    cache.setGeometryActive(
      cache.getOrCreate({ node: n, normalMode: "source", createGeometry: () => first }),
      true,
    );
    cache.invalidateNode(n.id);

    expect(dispose).not.toHaveBeenCalled();
    expect(cache.stats()).toMatchObject({ entries: 1, invalidations: 1, disposals: 0 });

    cache.setGeometryActive(first, false);

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(cache.stats()).toMatchObject({ entries: 0, disposals: 1 });
  });

  it("invalidateAll disposes active and inactive entries", () => {
    const cache = new PageGeometryCache({ enabled: true, maxEntries: 8, warnAtEntries: 8 });
    const first = geometry();
    const second = geometry();
    const disposeFirst = vi.spyOn(first, "dispose");
    const disposeSecond = vi.spyOn(second, "dispose");

    cache.setGeometryActive(
      cache.getOrCreate({ node: node("L0:0,0"), normalMode: "source", createGeometry: () => first }),
      true,
    );
    cache.getOrCreate({ node: node("L0:1,0", mesh(10)), normalMode: "source", createGeometry: () => second });
    cache.invalidateAll();

    expect(disposeFirst).toHaveBeenCalledTimes(1);
    expect(disposeSecond).toHaveBeenCalledTimes(1);
    expect(cache.stats()).toMatchObject({ entries: 0, invalidations: 1, disposals: 2 });
  });

  it("evicts least recently used inactive entries and disposes them", () => {
    const cache = new PageGeometryCache({ enabled: true, maxEntries: 1, warnAtEntries: 8 });
    const first = geometry();
    const second = geometry();
    const disposeFirst = vi.spyOn(first, "dispose");
    const disposeSecond = vi.spyOn(second, "dispose");

    cache.getOrCreate({ node: node("L0:0,0"), normalMode: "source", createGeometry: () => first });
    cache.getOrCreate({ node: node("L0:1,0", mesh(10)), normalMode: "source", createGeometry: () => second });

    expect(disposeFirst).toHaveBeenCalledTimes(1);
    expect(disposeSecond).not.toHaveBeenCalled();
    expect(cache.stats()).toMatchObject({ entries: 1, evictions: 1, disposals: 1 });
    cache.dispose();
  });

  it("does not evict active geometry entries", () => {
    const cache = new PageGeometryCache({ enabled: true, maxEntries: 1, warnAtEntries: 8 });
    const first = geometry();
    const second = geometry();
    const disposeFirst = vi.spyOn(first, "dispose");

    cache.setGeometryActive(
      cache.getOrCreate({ node: node("L0:0,0"), normalMode: "source", createGeometry: () => first }),
      true,
    );
    cache.getOrCreate({ node: node("L0:1,0", mesh(10)), normalMode: "source", createGeometry: () => second });

    expect(disposeFirst).not.toHaveBeenCalled();
    expect(cache.stats()).toMatchObject({ entries: 2, evictions: 0 });
    cache.dispose();
  });

  it("disabled cache creates fresh geometry and retains no entries", () => {
    const cache = new PageGeometryCache({ enabled: false, maxEntries: 8, warnAtEntries: 8 });
    const n = node();
    const first = cache.getOrCreate({ node: n, normalMode: "source", createGeometry: geometry });
    const second = cache.getOrCreate({ node: n, normalMode: "source", createGeometry: geometry });

    expect(second).not.toBe(first);
    expect(cache.owns(first)).toBe(false);
    expect(cache.stats()).toMatchObject({ entries: 0, misses: 2 });
  });

  it("estimatedBytes includes geometry attributes and index", () => {
    const cache = new PageGeometryCache({ enabled: true, maxEntries: 8, warnAtEntries: 8 });
    cache.getOrCreate({ node: node(), normalMode: "source", createGeometry: () => geometry(true) });

    expect(cache.stats().estimatedBytes).toBe(24);
    cache.dispose();
  });

  it("pruneToActiveNodes does not dispose active geometry outside the active node set", () => {
    const cache = new PageGeometryCache({ enabled: true, maxEntries: 8, warnAtEntries: 8 });
    const active = geometry();
    const inactive = geometry();
    const disposeActive = vi.spyOn(active, "dispose");
    const disposeInactive = vi.spyOn(inactive, "dispose");

    cache.setGeometryActive(
      cache.getOrCreate({ node: node("L0:0,0"), normalMode: "source", createGeometry: () => active }),
      true,
    );
    cache.getOrCreate({ node: node("L0:1,0", mesh(10)), normalMode: "source", createGeometry: () => inactive });

    cache.pruneToActiveNodes(new Set());

    expect(disposeActive).not.toHaveBeenCalled();
    expect(disposeInactive).toHaveBeenCalledTimes(1);
    expect(cache.stats()).toMatchObject({ entries: 1, invalidations: 1, disposals: 1 });
    cache.dispose();
  });
});
