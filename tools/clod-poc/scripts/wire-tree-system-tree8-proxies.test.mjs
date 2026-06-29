import { describe, expect, it } from "vitest";
import { wireTreeSystemTree8Source } from "./wire-tree-system-tree8-proxies.mjs";

const FIXTURE = `
import { createTreeRingImpostorNodeMaterialHandle } from "./tree_ring_impostor_node_material.js";

class TreeSystem {
  private geometries: TreeGeometryMap;
  private geometryKey: string;

  dispose(): void {
    disposeTreeGeometryMap(this.geometries);
    this.disposeBakedImpostorGeometries();
  }

  private createGpuRingDrawResources(): void {
            const shadowMaterialKey = "shadow:" + cascade + ":" + materialKey;
            materialHandles[shadowMaterialKey] = lod === "impostor" && this.settings.impostors.enabled && atlas?.ready
              ? createTreeRingImpostorNodeMaterialHandle(
                this.settings,
                shadowRingBuffers,
                atlas,
                this.currentLighting ?? undefined,
                this.hydrologyWater,
              )
              : createTreeRingNodeMaterialHandle(
                this.settings,
                shadowRingBuffers,
                lod,
                this.currentLighting ?? undefined,
                this.hydrologyWater,
              );
  }

  private createGpuRingTierDraw(
    species: TreeSpeciesId,
    lod: TreeLod,
    count: number,
    indirect: StorageBufferAttribute,
    indirectOffset: number,
    materialHandle: TreeMaterialHandle,
  ): TreeGpuRingMesh {
    const source = this.geometryForGpuRing(species, lod);
    const geometry = new THREE.InstancedBufferGeometry();
    return {} as TreeGpuRingMesh;
  }

  private createGpuRingShadowTierDraw(
    species: TreeSpeciesId,
    lod: TreeLod,
    cascade: number,
    count: number,
    indirect: StorageBufferAttribute,
    indirectOffset: number,
    materialHandle: TreeMaterialHandle,
  ): TreeGpuRingMesh {
    const source = this.geometryForGpuRing(species, lod);
    const geometry = new THREE.InstancedBufferGeometry();
    return {} as TreeGpuRingMesh;
  }
}
`;

const EDIT_COUNT = 6;

describe("TREE-8 crown proxy wiring script", () => {
  it("wires crown proxy geometry and materials for far/impostor shadow meshes", () => {
    const result = wireTreeSystemTree8Source(FIXTURE);

    expect(result.changed).toBe(true);
    expect(result.applied).toHaveLength(EDIT_COUNT);
    expect(result.source).toContain("createTreeCrownProxyGeometry");
    expect(result.source).toContain("createTreeCrownProxyNodeMaterialHandle");
    expect(result.source).toContain("private readonly crownProxyGeometry");
    expect(result.source).toContain("this.crownProxyGeometry.dispose()");
    expect(result.source).toContain("createGpuRingShadowMaterialHandle");
    expect(result.source).toContain("geometryForGpuRingShadow");
    expect(result.source).toContain('if (lod === "far" || lod === "impostor")');
    expect(result.source).toContain("private createGpuRingTierDraw");
    expect(result.source).toContain("private createGpuRingShadowTierDraw");
    expect(result.source.indexOf("private createGpuRingTierDraw")).toBeLessThan(result.source.indexOf("geometryForGpuRingShadow"));
  });

  it("preserves CRLF output", () => {
    const result = wireTreeSystemTree8Source(FIXTURE.replace(/\n/g, "\r\n"));

    expect(result.changed).toBe(true);
    expect(result.applied).toHaveLength(EDIT_COUNT);
    expect(result.source).toContain("\r\n");
  });

  it("is idempotent", () => {
    const first = wireTreeSystemTree8Source(FIXTURE);
    const second = wireTreeSystemTree8Source(first.source);

    expect(second.changed).toBe(false);
    expect(second.applied).toHaveLength(0);
    expect(second.skipped).toHaveLength(EDIT_COUNT);
  });

  it("treats the split runtime crown proxy implementation as already wired", () => {
    const result = wireTreeSystemTree8Source(`
class TreeSystem {
  private createGpuRingDrawResources(): TreeGpuRingDrawResources {
    return createTreeSystemGpuRingDrawResources({
      crownProxyGeometry: this.assets.crownProxyGeometry,
    }, maxInstancesPerGroup);
  }
}
`);

    expect(result.changed).toBe(false);
    expect(result.applied).toHaveLength(0);
    expect(result.skipped).toHaveLength(EDIT_COUNT);
  });
});
