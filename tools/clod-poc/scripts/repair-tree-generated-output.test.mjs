import { describe, expect, it } from "vitest";
import { repairTreeGeneratedOutputSource } from "./repair-tree-generated-output.mjs";

const DUPLICATE = `
class TreeSystem {
  private geometryForGpuRingShadow(species: TreeSpeciesId, lod: TreeLod): THREE.BufferGeometry {
    return this.geometryForGpuRing(species, lod);
  }

  private createGpuRingShadowTierDraw(
    species: TreeSpeciesId,
  ): TreeGpuRingMesh {
    const source = this.geometryForGpuRingShadow(species, lod);
    return {} as TreeGpuRingMesh;
  }

  private createGpuRingShadowTierDraw(
    species: TreeSpeciesId,
  ): TreeGpuRingMesh {
    const source = this.geometryForGpuRing(species, lod);
    return {} as TreeGpuRingMesh;
  }

  private usesGpuRingPrepass(lod: TreeLod): boolean {
    return false;
  }
}
`;

describe("repair generated tree output", () => {
  it("removes duplicate TREE-7 shadow-tier draw method after TREE-8 rewrites", () => {
    const result = repairTreeGeneratedOutputSource(DUPLICATE);

    expect(result.changed).toBe(true);
    expect(result.source.match(/private createGpuRingShadowTierDraw/g)).toHaveLength(1);
    expect(result.source).toContain("geometryForGpuRingShadow(species, lod)");
    expect(result.source).not.toContain("geometryForGpuRing(species, lod)");
    expect(result.source).toContain("private usesGpuRingPrepass");
  });

  it("is idempotent", () => {
    const first = repairTreeGeneratedOutputSource(DUPLICATE);
    const second = repairTreeGeneratedOutputSource(first.source);

    expect(second.changed).toBe(false);
  });

  it("preserves CRLF output", () => {
    const result = repairTreeGeneratedOutputSource(DUPLICATE.replace(/\n/g, "\r\n"));

    expect(result.changed).toBe(true);
    expect(result.source).toContain("\r\n");
  });
});
