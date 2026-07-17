import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import {
  GPU_CLOD_MESHLET_CULL_WGSL,
  GPU_CLOD_MESHLET_CULL_WORKGROUP_SIZE,
  gpuClodMeshletCullStats,
  meshletVisibleForPlanes,
  packFrustumPlanes,
  resetGpuClodMeshletCull,
  setGpuClodMeshletCullEnabled,
  updateGpuClodMeshletCull,
} from "./gpu_clod_meshlet_cull.js";
import {
  clearGpuClodResidentPages,
  eachGpuClodResidentPage,
  registerGpuClodResidentPage,
  retireGpuClodResidentPage,
} from "./gpu_clod_resident_registry.js";
import type { GpuClodResidentPage } from "./gpu_clod_resident_types.js";

function fakeBuffer(): GPUBuffer {
  return { destroy: () => undefined } as unknown as GPUBuffer;
}

function fakePage(id: string, meshletCount: number): GpuClodResidentPage {
  return {
    id,
    revision: 0,
    level: 0,
    vertexBuffer: fakeBuffer(),
    indexBuffer: fakeBuffer(),
    vertexCount: 3,
    indexCount: 3,
    byteLength: 0,
    bounds: { center: [0, 0, 0], radius: 1, minY: 0, maxY: 1 },
    meshlets: meshletCount > 0
      ? {
        headers: fakeBuffer(),
        bounds: fakeBuffer(),
        hierarchyHeaders: fakeBuffer(),
        hierarchyBounds: fakeBuffer(),
        indirect: fakeBuffer(),
        meshletCount,
        hierarchyNodeCount: meshletCount,
        byteLength: 0,
      }
      : undefined,
    errorWorld: 0,
    lowBenefit: false,
  };
}

afterEach(() => {
  clearGpuClodResidentPages();
  resetGpuClodMeshletCull();
  setGpuClodMeshletCullEnabled(null);
});

describe("gpu clod meshlet cull WGSL contract", () => {
  it("binds frustum planes, bounds, and indirect args", () => {
    expect(GPU_CLOD_MESHLET_CULL_WGSL).toContain("@group(0) @binding(0) var<uniform> frustum");
    expect(GPU_CLOD_MESHLET_CULL_WGSL).toContain("@group(0) @binding(1) var<storage, read> bounds");
    expect(GPU_CLOD_MESHLET_CULL_WGSL).toContain("@group(0) @binding(2) var<storage, read_write> indirect");
    expect(GPU_CLOD_MESHLET_CULL_WGSL).toContain(`@workgroup_size(${GPU_CLOD_MESHLET_CULL_WORKGROUP_SIZE})`);
  });

  it("only rewrites the instanceCount lane of each indirect command", () => {
    expect(GPU_CLOD_MESHLET_CULL_WGSL).toContain("indirect[meshletId * 5u + 1u] = select(0u, 1u, visible);");
    // Index count / first index / base vertex lanes stay whatever the build pass wrote.
    expect(GPU_CLOD_MESHLET_CULL_WGSL).not.toContain("indirect[meshletId * 5u] =");
    expect(GPU_CLOD_MESHLET_CULL_WGSL).not.toContain("+ 2u] =");
  });

  it("bounds-checks against the runtime bounds array length", () => {
    expect(GPU_CLOD_MESHLET_CULL_WGSL).toContain("arrayLength(&bounds)");
  });
});

describe("frustum plane packing parity", () => {
  it("matches THREE.Frustum.intersectsSphere for random spheres", () => {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 2000);
    camera.position.set(120, 40, -60);
    camera.lookAt(200, 10, 100);
    camera.updateMatrixWorld();

    const planes = packFrustumPlanes(camera, new Float32Array(24));
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );

    let seed = 42;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let sample = 0; sample < 500; sample++) {
      const sphere: [number, number, number, number] = [
        (random() - 0.5) * 3000,
        (random() - 0.5) * 500,
        (random() - 0.5) * 3000,
        random() * 80,
      ];
      const expected = frustum.intersectsSphere(
        new THREE.Sphere(new THREE.Vector3(sphere[0], sphere[1], sphere[2]), sphere[3]),
      );
      expect(meshletVisibleForPlanes(planes, sphere)).toBe(expected);
    }
  });
});

describe("resident registry iteration", () => {
  it("visits live pages and skips retired ones", () => {
    registerGpuClodResidentPage(fakePage("L0:0,0", 4));
    registerGpuClodResidentPage(fakePage("L0:1,0", 2));
    registerGpuClodResidentPage(fakePage("L0:2,0", 8));
    retireGpuClodResidentPage("L0:1,0");

    const seen: string[] = [];
    eachGpuClodResidentPage((page) => seen.push(page.id));
    expect(seen.sort()).toEqual(["L0:0,0", "L0:2,0"]);
  });
});

describe("updateGpuClodMeshletCull without a device", () => {
  it("reports disabled stats when force-disabled", () => {
    setGpuClodMeshletCullEnabled(false);
    updateGpuClodMeshletCull(new THREE.PerspectiveCamera());
    expect(gpuClodMeshletCullStats()).toMatchObject({ enabled: false, ready: false, pages: 0 });
  });

  it("stays not-ready when no WebGPU device is bridged", () => {
    setGpuClodMeshletCullEnabled(true);
    registerGpuClodResidentPage(fakePage("L0:0,0", 4));
    updateGpuClodMeshletCull(new THREE.PerspectiveCamera());
    expect(gpuClodMeshletCullStats()).toMatchObject({ enabled: true, ready: false });
  });
});
