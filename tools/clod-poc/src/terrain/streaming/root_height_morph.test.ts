import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { ClodPageNode, PageMesh } from "../../types.js";
import { applyRootHeightMorph, resetRootHeightMorph } from "./root_height_morph.js";

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

function view(n: ClodPageNode) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(n.mesh.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(n.mesh.indices, 1));
  return { node: n, mesh: new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()) };
}

describe("root height morph", () => {
  it("builds a Y-only relative morph target from the opposite root set", () => {
    const incoming = view(node("incoming", 20, "fadeIn"));
    const outgoing = view(node("outgoing", 10, "fadeOut"));

    const stats = applyRootHeightMorph(incoming, [outgoing], 0.75);
    const morph = incoming.mesh.geometry.morphAttributes.position?.[0] as THREE.BufferAttribute;

    expect(stats.builtRoots).toBe(1);
    expect(stats.builtVertices).toBe(3);
    expect(Array.from(morph.array as Float32Array)).toEqual([
      0, -10, 0,
      0, -10, 0,
      0, -10, 0,
    ]);
    expect(incoming.mesh.morphTargetInfluences?.[0]).toBe(0.75);
    expect(incoming.node.rootTransition?.parentHeightMorphReady).toBe(true);
  });

  it("reuses an existing morph target when the signature is unchanged", () => {
    const incoming = view(node("incoming", 20, "fadeIn"));
    const outgoing = view(node("outgoing", 10, "fadeOut"));

    applyRootHeightMorph(incoming, [outgoing], 1);
    const stats = applyRootHeightMorph(incoming, [outgoing], 0.25);

    expect(stats.builtRoots).toBe(0);
    expect(incoming.mesh.morphTargetInfluences?.[0]).toBe(0.25);
  });

  it("resets morph influence without touching geometry", () => {
    const incoming = view(node("incoming", 20, "fadeIn"));
    const outgoing = view(node("outgoing", 10, "fadeOut"));
    applyRootHeightMorph(incoming, [outgoing], 1);

    resetRootHeightMorph(incoming);

    expect(incoming.mesh.morphTargetInfluences?.[0]).toBe(0);
  });
});
