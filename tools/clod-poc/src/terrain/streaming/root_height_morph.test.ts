import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { ClodPageNode, PageMesh } from "../../types.js";
import {
  applyRootHeightMorph,
  resetRootHeightMorph,
  ROOT_HEIGHT_MORPH_ATTRIBUTE,
  ROOT_HEIGHT_MORPH_ENABLED,
} from "./root_height_morph.js";

function meshAtHeight(height: number): PageMesh {
  return {
    positions: new Float32Array([
      0, height, 0,
      10, height, 0,
      0, height, 10,
    ]),
    normals: new Float32Array([
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
    ]),
    paintSlots: new Float32Array([0, 0, 0]),
    materialWeights: new Float32Array(12),
    materialWeightStride: 4,
    indices: new Uint32Array([0, 1, 2]),
  };
}

function node(id: string, height: number, mode: "fadeIn" | "fadeOut"): ClodPageNode {
  return {
    id,
    revision: 1,
    level: 0,
    children: [],
    mesh: meshAtHeight(height),
    footprint: { minX: 0, minZ: 0, maxX: 10, maxZ: 10 },
    bounds: { center: [5, height, 5], radius: 10, minY: height, maxY: height },
    errorWorld: 0,
    lowBenefit: false,
    rootTransition: { mode, progress: 0.5, groupId: 7 },
  };
}

function view(n: ClodPageNode, morphValues: readonly number[] = [0, 0, 0]) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(n.mesh.positions, 3));
  geometry.setAttribute(
    ROOT_HEIGHT_MORPH_ATTRIBUTE,
    new THREE.BufferAttribute(new Float32Array(morphValues), 1),
  );
  geometry.setIndex(new THREE.BufferAttribute(n.mesh.indices, 1));
  return { node: n, mesh: new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()) };
}

describe("root height morph", () => {
  it("is disabled for streamed terrain", () => {
    expect(ROOT_HEIGHT_MORPH_ENABLED).toBe(false);
  });

  it("never builds morph deltas and clears any stale values", () => {
    const incoming = view(node("incoming", 20, "fadeIn"), [-10, -10, -10]);
    const outgoing = view(node("outgoing", 10, "fadeOut"));

    const stats = applyRootHeightMorph(incoming, [outgoing]);
    const morph = incoming.mesh.geometry.getAttribute(ROOT_HEIGHT_MORPH_ATTRIBUTE) as THREE.BufferAttribute;

    expect(stats).toEqual({ builtRoots: 0, builtVertices: 0, buildMs: 0 });
    expect(Array.from(morph.array as Float32Array)).toEqual([0, 0, 0]);
    expect(incoming.node.rootTransition?.parentHeightMorphReady).toBe(false);
  });

  it("keeps reset idempotent", () => {
    const incoming = view(node("incoming", 20, "fadeIn"));

    resetRootHeightMorph(incoming);
    resetRootHeightMorph(incoming);

    const morph = incoming.mesh.geometry.getAttribute(ROOT_HEIGHT_MORPH_ATTRIBUTE) as THREE.BufferAttribute;
    expect(Array.from(morph.array as Float32Array)).toEqual([0, 0, 0]);
  });
});
