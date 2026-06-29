import { describe, expect, it } from "vitest";
import { wireTreeSystemSource } from "./wire-tree-system-tree4-5.mjs";

const FIXTURE = `
import {
  disposeTreeGeometryMap,
  createTreeBakedImpostorGeometry,
  createTreeGeometryMap,
  treeGeometryKey,
  type TreeGeometryMap,
} from "./tree_geometry.js";
import {
  createTreeNodeMaterialHandle,
  createTreeRingNodeMaterialHandle,
  type TreeHydrologyWater,
  type TreeRingInstanceBuffers,
} from "./tree_node_material.js";

interface TreeGpuRingDrawResources {
  materialHandles: Record<TreeLod, TreeMaterialHandle>;
}

function createGpuRingDrawResources() {
    const materialHandles = {} as Record<TreeLod, TreeMaterialHandle>;
    for (const lod of TREE_LODS) {
      materialHandles[lod] = this.currentLighting
        ? createTreeRingNodeMaterialHandle(this.settings, ringBuffers, lod, this.currentLighting, this.hydrologyWater)
        : createTreeRingNodeMaterialHandle(this.settings, ringBuffers, lod, undefined, this.hydrologyWater);
    }
    const meshes: TreeGpuRingMesh[] = [];
    for (const species of TREE_SPECIES) {
      for (const lod of TREE_LODS) {
        const group = treeGpuRingGroupIndex(species, lod);
        meshes.push(this.createGpuRingTierDraw(
          species,
          lod,
          count,
          indirect,
          group * 5 * Uint32Array.BYTES_PER_ELEMENT,
          materialHandles[lod],
        ));
      }
    }
}

class TreeSystem {
  private geometryForGpuRing(species: TreeSpeciesId, lod: TreeLod): THREE.BufferGeometry {
    // Stage 3b decision: GPU ring uses the procedural impostor-card geometry first.
    // WebGPU render-to-atlas baking can replace this later without blocking the pipeline.
    return this.geometries[species][lod];
  }
}
`;

describe("TREE-4/TREE-5 wiring script", () => {
  it("applies all guarded tree system rewrites", () => {
    const result = wireTreeSystemSource(FIXTURE);

    expect(result.changed).toBe(true);
    expect(result.applied).toHaveLength(5);
    expect(result.source).toContain("selectTreeGpuRingGeometry");
    expect(result.source).toContain("createTreeRingImpostorNodeMaterialHandle");
    expect(result.source).toContain("materialHandles: Record<string, TreeMaterialHandle>");
    expect(result.source).toContain('const materialKey = species + ":" + lod;');
    expect(result.source).toContain("return selectTreeGpuRingGeometry({");
  });

  it("is idempotent after the first rewrite", () => {
    const first = wireTreeSystemSource(FIXTURE);
    const second = wireTreeSystemSource(first.source);

    expect(second.changed).toBe(false);
    expect(second.applied).toHaveLength(0);
    expect(second.skipped).toHaveLength(5);
    expect(second.source).toBe(first.source);
  });

  it("fails fast when the source shape does not match", () => {
    expect(() => wireTreeSystemSource("class TreeSystem {}\n")).toThrow(/Cannot apply/);
  });
});
