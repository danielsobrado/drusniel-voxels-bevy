import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  TREE_LODS,
  TREE_RING_SHADOW_CASCADE_COUNT,
  TREE_RING_SHADOW_PLANE_COUNT,
  TREE_RING_SHADOW_PLANE_WORDS,
  TREE_SPECIES,
  packTreeRingShadowCascadePlanes,
  treeRingShadowCascadePlaneOffset,
  treeRingShadowCascadePlanesFromCamera,
  treeRingShadowCascadePlanesFromCameras,
  treeRingShadowCasterCascadeIndices,
  treeRingShadowCasterGroupCount,
  treeRingShadowCasterGroupCounts,
  treeRingShadowCasterGroupIndex,
  treeRingShadowCasterGroupRegion,
  treeRingShadowSafeCascadeCount,
} from "./index.js";

describe("tree ring shadow layout", () => {
  it("indexes groups by cascade then tree group", () => {
    const groupsPerCascade = TREE_SPECIES.length * TREE_LODS.length;

    expect(treeRingShadowCasterGroupCount()).toBe(TREE_RING_SHADOW_CASCADE_COUNT * groupsPerCascade);
    expect(treeRingShadowCasterGroupIndex("oak", "near", 0)).toBe(0);
    expect(treeRingShadowCasterGroupIndex("oak", "impostor", 0)).toBe(3);
    expect(treeRingShadowCasterGroupIndex("pine", "near", 0)).toBe(4);
    expect(treeRingShadowCasterGroupIndex("oak", "near", 1)).toBe(groupsPerCascade);
  });

  it("returns contiguous storage regions", () => {
    const region = treeRingShadowCasterGroupRegion("pine", "far", 2, 10);
    const expectedStart = treeRingShadowCasterGroupIndex("pine", "far", 2) * 10;

    expect(region).toEqual({ start: expectedStart, end: expectedStart + 10, firstInstance: expectedStart });
  });

  it("packs cascade planes", () => {
    const first = new Float32Array(TREE_RING_SHADOW_PLANE_COUNT * TREE_RING_SHADOW_PLANE_WORDS).fill(1);
    const second = new Float32Array(TREE_RING_SHADOW_PLANE_COUNT * TREE_RING_SHADOW_PLANE_WORDS).fill(2);
    const packed = packTreeRingShadowCascadePlanes([first, second], 4);

    expect(treeRingShadowSafeCascadeCount(99)).toBe(TREE_RING_SHADOW_CASCADE_COUNT);
    expect(packed[0]).toBe(1);
    expect(packed[treeRingShadowCascadePlaneOffset(1)]).toBe(2);
    expect(packed[treeRingShadowCascadePlaneOffset(2)]).toBe(0);
  });

  it("extracts normalized cascade planes from cameras", () => {
    const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 1, 100);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();

    const planes = treeRingShadowCascadePlanesFromCamera(camera);
    expect(planes.length).toBe(TREE_RING_SHADOW_PLANE_COUNT * TREE_RING_SHADOW_PLANE_WORDS);
    for (let i = 0; i < TREE_RING_SHADOW_PLANE_COUNT; i++) {
      const offset = i * TREE_RING_SHADOW_PLANE_WORDS;
      const normalLength = Math.hypot(planes[offset], planes[offset + 1], planes[offset + 2]);
      expect(normalLength).toBeCloseTo(1, 5);
    }
  });

  it("packs planes from multiple cascade cameras", () => {
    const first = new THREE.OrthographicCamera(-10, 10, 10, -10, 1, 100);
    const second = new THREE.OrthographicCamera(-20, 20, 20, -20, 1, 200);
    first.updateProjectionMatrix();
    second.updateProjectionMatrix();

    const packed = treeRingShadowCascadePlanesFromCameras([first, second], 4);
    expect(packed.length).toBe(TREE_RING_SHADOW_CASCADE_COUNT * TREE_RING_SHADOW_PLANE_COUNT * TREE_RING_SHADOW_PLANE_WORDS);
    expect(packed[0]).not.toBeNaN();
    expect(packed[treeRingShadowCascadePlaneOffset(1)]).not.toBeNaN();
    expect(packed[treeRingShadowCascadePlaneOffset(2)]).toBe(0);
  });

  it("selects caster cascades from CSM planes only", () => {
    const packed = packTreeRingShadowCascadePlanes([
      boxPlanes(10),
      boxPlanes(30),
    ], 2);

    expect(treeRingShadowCasterCascadeIndices([0, 0, 0], 1, packed, 2)).toEqual([0, 1]);
    expect(treeRingShadowCasterCascadeIndices([20, 0, 0], 1, packed, 2)).toEqual([1]);
    expect(treeRingShadowCasterCascadeIndices([40, 0, 0], 1, packed, 2)).toEqual([]);
  });

  it("counts per-cascade caster groups and clamps overflow", () => {
    const packed = packTreeRingShadowCascadePlanes([boxPlanes(10), boxPlanes(30)], 2);
    const result = treeRingShadowCasterGroupCounts([
      { species: "oak", lod: "far", center: [0, 0, 0], radiusM: 1 },
      { species: "oak", lod: "far", center: [20, 0, 0], radiusM: 1 },
      { species: "pine", lod: "near", center: [40, 0, 0], radiusM: 1 },
    ], packed, 1, 2);

    expect(result.groupCounts[treeRingShadowCasterGroupIndex("oak", "far", 0, 2)]).toBe(1);
    expect(result.groupCounts[treeRingShadowCasterGroupIndex("oak", "far", 1, 2)]).toBe(1);
    expect(result.groupCounts[treeRingShadowCasterGroupIndex("pine", "near", 1, 2)]).toBe(0);
    expect(result.overflowed).toBe(true);
  });
});

function boxPlanes(extent: number): Float32Array {
  return new Float32Array([
    1, 0, 0, extent,
    -1, 0, 0, extent,
    0, 1, 0, extent,
    0, -1, 0, extent,
    0, 0, 1, extent,
    0, 0, -1, extent,
  ]);
}
