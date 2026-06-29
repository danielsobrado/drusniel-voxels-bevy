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
  private setImpostorAtlases(atlases: Partial<Record<TreeSpeciesId, TreeImpostorAtlas>>): void {
    for (const atlas of Object.values(this.impostorAtlases)) atlas?.dispose();
    this.impostorAtlases = { ...atlases };
    this.disposeImpostorMaterials();
    this.updateImpostorMaterials();
  }

  private createPatch() {
        geometry.setAttribute("treeLodFade", new THREE.InstancedBufferAttribute(
          new Float32Array(speciesCapacity).fill(1),
          1,
        ));
        if (lod === "impostor") {
  }

  private updatePatchLods() {
        this.placeTreeInstance(patch, instance, primaryLod, crossfade ? selection.fade : 1, cameraPosition, write);
            this.placeTreeInstance(patch, instance, secondaryLod, selection.secondaryFade, cameraPosition, write);
  }

  private placeTreeInstance(
    patch: TreePatch,
    instance: TreeInstance,
    lod: TreeLod,
    fade: number,
    cameraPosition: THREE.Vector3,
    write: TreeMeshWriteState,
  ): void {
    if (this.writeTreeLodFadeIfChanged(mesh, index, fade)) write.fadeChanged.set(mesh, true);
  }

  private updateTreeMeshAfterLod() {
    if (worldXZChanged) this.treeWorldXZ(mesh).needsUpdate = true;
    if (fadeChanged) this.treeLodFade(mesh).needsUpdate = true;
    if (impostorUvChanged) this.treeImpostorUvRect(mesh).needsUpdate = true;
  }

  private writeTreeLodFadeIfChanged(mesh: THREE.InstancedMesh, index: number, fade: number): boolean {
    const attribute = this.treeLodFade(mesh);
    const array = attribute.array as Float32Array;
    if (Math.abs(array[index] - fade) <= TREE_INSTANCE_ATTRIBUTE_EPSILON) return false;
    array[index] = fade;
    return true;
  }

  private writeTreeImpostorUvRectIfChanged(
    mesh: THREE.InstancedMesh,
    index: number,
    instance: TreeInstance,
    cameraPosition: THREE.Vector3,
  ): boolean {
    return false;
  }

  private treeLodFade(mesh: THREE.InstancedMesh): THREE.InstancedBufferAttribute {
    return mesh.geometry.getAttribute("treeLodFade") as THREE.InstancedBufferAttribute;
  }

  private treeImpostorUvRect(mesh: THREE.InstancedMesh): THREE.InstancedBufferAttribute {
    return mesh.geometry.getAttribute("treeImpostorUvRect") as THREE.InstancedBufferAttribute;
  }

  private geometryForGpuRing(species: TreeSpeciesId, lod: TreeLod): THREE.BufferGeometry {
    // Stage 3b decision: GPU ring uses the procedural impostor-card geometry first.
    // WebGPU render-to-atlas baking can replace this later without blocking the pipeline.
    return this.geometries[species][lod];
  }
}
`;

const EDIT_COUNT = 14;

describe("TREE-4/TREE-5 wiring script", () => {
  it("applies all guarded tree system rewrites", () => {
    const result = wireTreeSystemSource(FIXTURE);

    expect(result.changed).toBe(true);
    expect(result.applied).toHaveLength(EDIT_COUNT);
    expect(result.source).toContain("selectTreeGpuRingGeometry");
    expect(result.source).toContain("createTreeRingImpostorNodeMaterialHandle");
    expect(result.source).toContain("materialHandles: Record<string, TreeMaterialHandle>");
    expect(result.source).toContain('const materialKey = species + ":" + lod;');
    expect(result.source).toContain("return selectTreeGpuRingGeometry({");
    expect(result.source).toContain("this.clearGpuRing();");
    expect(result.source).toContain("treeLodDitherRole");
    expect(result.source).toContain("ditherRole: number");
    expect(result.source).toContain("this.writeTreeLodDitherRoleIfChanged(mesh, index, ditherRole)");
  });

  it("applies rewrites to CRLF source and preserves CRLF output", () => {
    const crlfFixture = FIXTURE.replace(/\n/g, "\r\n");
    const result = wireTreeSystemSource(crlfFixture);

    expect(result.changed).toBe(true);
    expect(result.applied).toHaveLength(EDIT_COUNT);
    expect(result.source).toContain("\r\n");
    expect(result.source).not.toContain("\nimport { selectTreeGpuRingGeometry");
    expect(result.source).toContain("\r\nimport { selectTreeGpuRingGeometry");
  });

  it("is idempotent after the first rewrite", () => {
    const first = wireTreeSystemSource(FIXTURE);
    const second = wireTreeSystemSource(first.source);

    expect(second.changed).toBe(false);
    expect(second.applied).toHaveLength(0);
    expect(second.skipped).toHaveLength(EDIT_COUNT);
    expect(second.source).toBe(first.source);
  });

  it("fails fast when the source shape does not match", () => {
    expect(() => wireTreeSystemSource("class TreeSystem {}\n")).toThrow(/Cannot apply/);
  });
});
