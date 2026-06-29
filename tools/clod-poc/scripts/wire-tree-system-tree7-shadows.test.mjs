import { describe, expect, it } from "vitest";
import { wireTreeSystemTree7Source } from "./wire-tree-system-tree7-shadows.mjs";

const FIXTURE = `
import {
  treeGpuRingGroupIndex,
  TREE_GPU_RING_GROUP_COUNT,
  treeGpuRingKey,
} from "../gpu/tree_ring_compute.js";
import type { EnvironmentLighting } from "../environment/environment.js";
import type { ForestLightingMaterialState } from "../forest_lighting/index.js";

interface TreeGpuRingDrawResources {
  meshes: TreeGpuRingMesh[];
  cell: StorageInstancedBufferAttribute;
  indirect: StorageBufferAttribute;
  outputBuffers: TreeGpuRingOutputBuffers;
  materialHandles: Record<string, TreeMaterialHandle>;
}

class TreeSystem {
  private createGpuRingDrawResources(maxInstancesPerGroup: number): TreeGpuRingDrawResources {
    const count = Math.max(1, maxInstancesPerGroup);
    const sharedInstanceCount = count * TREE_GPU_RING_GROUP_COUNT;
    const indirect = new StorageBufferAttribute(new Uint32Array(TREE_GPU_RING_GROUP_COUNT * 5), 5);
    indirect.name = "tree-ring-indirect";
    this.gpuBackend.createIndirectStorageAttribute(indirect);
    const cell = this.createStorageInstancedAttribute("cell", sharedInstanceCount);
    const ringBuffers: TreeRingInstanceBuffers = { cell, capacity: sharedInstanceCount };
    const materialHandles = {} as Record<string, TreeMaterialHandle>;
    const meshes: TreeGpuRingMesh[] = [];
    return {
      meshes,
      cell,
      indirect,
      materialHandles,
      outputBuffers: {
        cell: this.gpuBufferForAttribute(cell),
        indirectArgs: this.gpuBufferForAttribute(indirect),
      },
    };
  }

  private updateGpuRingTrees(center: THREE.Vector3, camera?: THREE.Camera): boolean {
    if (this.gpuRingCompute && this.gpuRingDraw) {
      const frustumPlanes = this.frustumPlanes(camera);
      const dispatched = this.gpuRingCompute.dispatch({
        centerX: center.x,
        centerZ: center.z,
        worldCells: this.worldCells,
        maxInstancesPerGroup: treeGpuRingGroupCapacity(this.settings),
        indexCounts: this.gpuRingIndexCounts(),
        frustumPlanes,
      });
      void dispatched;
    }
    return true;
  }
}
`;

const EDIT_COUNT = 7;

describe("TREE-7 tree system wiring script", () => {
  it("applies shadow buffer and dispatch rewrites", () => {
    const result = wireTreeSystemTree7Source(FIXTURE);

    expect(result.changed).toBe(true);
    expect(result.applied).toHaveLength(EDIT_COUNT);
    expect(result.source).toContain("TREE_GPU_RING_SHADOW_GROUP_COUNT");
    expect(result.source).toContain("getRealtimeSunShadowCascadeCameras");
    expect(result.source).toContain("treeRingShadowCascadePlanesFromCameras");
    expect(result.source).toContain("shadowCell: StorageInstancedBufferAttribute");
    expect(result.source).toContain("tree-ring-shadow-indirect");
    expect(result.source).toContain("shadowCascadePlanes");
    expect(result.source).toContain("maxShadowCastersPerGroup");
  });

  it("preserves CRLF output", () => {
    const result = wireTreeSystemTree7Source(FIXTURE.replace(/\n/g, "\r\n"));

    expect(result.changed).toBe(true);
    expect(result.applied).toHaveLength(EDIT_COUNT);
    expect(result.source).toContain("\r\n");
  });

  it("is idempotent", () => {
    const first = wireTreeSystemTree7Source(FIXTURE);
    const second = wireTreeSystemTree7Source(first.source);

    expect(second.changed).toBe(false);
    expect(second.applied).toHaveLength(0);
    expect(second.skipped).toHaveLength(EDIT_COUNT);
  });
});
