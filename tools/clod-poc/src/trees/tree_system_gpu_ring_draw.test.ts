import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { StorageBufferAttribute } from "three/webgpu";
import { REALTIME_SUN_SHADOW_CASTER_LAYER_BASE } from "../rendering/realtime_sun_shadows.js";
import {
  createTreeGpuRingDrawBuffers,
  createTreeGpuRingInstancedGeometry,
  createTreeGpuRingMesh,
  createTreeGpuRingShadowMesh,
  isRenderableTreeGpuRingGeometry,
  setTreeGpuRingIndirect,
  setTreeGpuRingMeshesVisible,
  treeGpuBufferForAttribute,
  treeGpuRingDrawCountForGeometry,
  TREE_GPU_RING_INSTANCE_VEC4S,
  treeRingShadowCasterGroupCount,
  type TreeMaterialHandle,
  type TreeWebGpuBackendBufferAccess,
} from "./index.js";


describe("tree system GPU ring draw helpers", () => {
  it("creates indirect and cell storage buffers", () => {
    const backend = fakeBackend();
    const bundle = createTreeGpuRingDrawBuffers(backend, 3, 2);

    expect(bundle.indirect.name).toBe("tree-ring-indirect");
    expect(bundle.indirect.itemSize).toBe(5);
    expect(bundle.indirect.count).toBe(2);
    expect(bundle.cell.name).toBe("tree-ring-cell");
    expect(bundle.cell.itemSize).toBe(4);
    expect(bundle.cell.count).toBe(6 * TREE_GPU_RING_INSTANCE_VEC4S);
    expect(bundle.shadowCell).toBeUndefined();
    expect(bundle.shadowIndirect).toBeUndefined();
    expect(backend.createIndirectStorageAttribute).toHaveBeenCalledTimes(1);
    expect(backend.createStorageAttribute).toHaveBeenCalledTimes(1);
    expect(bundle.outputBuffers.cell).toBeDefined();
    expect(bundle.outputBuffers.indirectArgs).toBeDefined();
  });

  it("creates optional per-cascade shadow caster buffers", () => {
    const backend = fakeBackend();
    const bundle = createTreeGpuRingDrawBuffers(backend, 3, 2, {
      maxShadowCastersPerGroup: 5,
      shadowCascadeCount: 4,
    });
    const shadowGroups = treeRingShadowCasterGroupCount(4);

    expect(bundle.shadowIndirect?.name).toBe("tree-ring-shadow-indirect");
    expect(bundle.shadowIndirect?.itemSize).toBe(5);
    expect(bundle.shadowIndirect?.count).toBe(shadowGroups);
    expect(bundle.shadowCell?.name).toBe("tree-ring-shadow-cell");
    expect(bundle.shadowCell?.itemSize).toBe(4);
    expect(bundle.shadowCell?.count).toBe(shadowGroups * 5 * TREE_GPU_RING_INSTANCE_VEC4S);
    expect(bundle.outputBuffers.shadowCell).toBeDefined();
    expect(bundle.outputBuffers.shadowIndirectArgs).toBeDefined();
    expect(backend.createIndirectStorageAttribute).toHaveBeenCalledTimes(2);
    expect(backend.createStorageAttribute).toHaveBeenCalledTimes(2);
  });

  it("builds indirect instanced geometry from source attributes", () => {
    const setIndirect = vi.fn();
    withSetIndirectStub(setIndirect, () => {
      const source = new THREE.BoxGeometry(1, 1, 1);
      const indirect = new StorageBufferAttribute(new Uint32Array(5), 5);
      const geometry = createTreeGpuRingInstancedGeometry(source, 7, indirect, 16, 128);

      expect(geometry.getAttribute("position")).toBe(source.getAttribute("position"));
      expect(geometry.getIndex()).toBe(source.getIndex());
      expect(geometry.instanceCount).toBe(7);
      expect(geometry.boundingBox?.max.x).toBe(129);
      expect(geometry.boundingSphere?.radius).toBeGreaterThan(0);
      expect(setIndirect).toHaveBeenCalledWith(indirect, 16);
    });
  });

  it("uses safe draw counts for indexed and non-indexed geometry", () => {
    const indexed = new THREE.BoxGeometry(1, 1, 1);
    const nonIndexed = indexed.toNonIndexed();
    const empty = new THREE.BufferGeometry();
    empty.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
    const emptyIndexed = new THREE.BufferGeometry();
    emptyIndexed.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
    emptyIndexed.setIndex([]);

    expect(treeGpuRingDrawCountForGeometry(indexed)).toBe(indexed.getIndex()?.count);
    expect(treeGpuRingDrawCountForGeometry(nonIndexed)).toBe(nonIndexed.getAttribute("position").count);
    expect(treeGpuRingDrawCountForGeometry(empty)).toBe(0);
    expect(treeGpuRingDrawCountForGeometry(emptyIndexed)).toBe(0);
    expect(isRenderableTreeGpuRingGeometry(indexed)).toBe(true);
    expect(isRenderableTreeGpuRingGeometry(nonIndexed)).toBe(true);
    expect(isRenderableTreeGpuRingGeometry(empty)).toBe(false);
    expect(isRenderableTreeGpuRingGeometry(emptyIndexed)).toBe(false);
  });

  it("throws when indirect geometry support is unavailable", () => {
    const indirect = new StorageBufferAttribute(new Uint32Array(5), 5);
    const geometry = new THREE.InstancedBufferGeometry();
    Object.defineProperty(geometry, "setIndirect", { value: undefined, configurable: true });
    expect(() => setTreeGpuRingIndirect(geometry, indirect, 0))
      .toThrow(/setIndirect support/);
  });

  it("creates a mesh with ring draw flags", () => {
    const geometry = new THREE.InstancedBufferGeometry();
    const regular = new THREE.MeshBasicMaterial();
    const debug = new THREE.MeshBasicMaterial();
    const mesh = createTreeGpuRingMesh(geometry, fakeHandle(regular, debug), "oak", "near", true, true);

    expect(mesh.name).toBe("trees-ring-gpu-oak-near");
    expect(mesh.material).toBe(debug);
    expect(mesh.frustumCulled).toBe(false);
    expect(mesh.castShadow).toBe(true);
    expect(mesh.receiveShadow).toBe(false);
  });

  it("creates a shadow-only mesh on the cascade-specific caster layer", () => {
    const geometry = new THREE.InstancedBufferGeometry();
    const regular = new THREE.MeshBasicMaterial();
    const debug = new THREE.MeshBasicMaterial();
    const mesh = createTreeGpuRingShadowMesh(geometry, fakeHandle(regular, debug), "pine", "far", 2);

    expect(mesh.name).toBe("trees-ring-gpu-shadow-c2-pine-far");
    expect(mesh.material).toBe(regular);
    expect(mesh.castShadow).toBe(true);
    expect(mesh.receiveShadow).toBe(false);
    expect(mesh.layers.isEnabled(REALTIME_SUN_SHADOW_CASTER_LAYER_BASE + 2)).toBe(true);
    expect(mesh.layers.isEnabled(0)).toBe(false);
  });

  it("toggles visibility for ring objects", () => {
    const a = new THREE.Object3D();
    const b = new THREE.Object3D();
    setTreeGpuRingMeshesVisible([a, b], false);
    expect(a.visible).toBe(false);
    expect(b.visible).toBe(false);
    setTreeGpuRingMeshesVisible([a, b], true);
    expect(a.visible).toBe(true);
    expect(b.visible).toBe(true);
  });

  it("throws when a backend buffer is missing", () => {
    const backend = fakeBackend(false);
    const attribute = new THREE.BufferAttribute(new Float32Array(4), 4);
    attribute.name = "missing-buffer";
    expect(() => treeGpuBufferForAttribute(backend, attribute)).toThrow(/missing-buffer/);
  });
});

function withSetIndirectStub(setIndirect: ReturnType<typeof vi.fn>, run: () => void): void {
  const prototype = THREE.InstancedBufferGeometry.prototype as THREE.InstancedBufferGeometry & {
    setIndirect?: typeof setIndirect;
  };
  const previous = prototype.setIndirect;
  (prototype as any).setIndirect = setIndirect;
  try {
    run();
  } finally {
    if (previous) prototype.setIndirect = previous;
    else delete (prototype as any).setIndirect;
  }
}

function fakeBackend(hasBuffer = true): TreeWebGpuBackendBufferAccess {
  const buffers = new WeakMap<THREE.BufferAttribute, GPUBuffer>();
  const register = (attribute: THREE.BufferAttribute) => {
    if (hasBuffer) buffers.set(attribute, {} as GPUBuffer);
  };
  return {
    createStorageAttribute: vi.fn(register),
    createIndirectStorageAttribute: vi.fn(register),
    get: vi.fn((attribute: THREE.BufferAttribute) => ({ buffer: buffers.get(attribute) })),
  };
}

function fakeHandle(regularMaterial: THREE.Material, debugMaterial: THREE.Material): TreeMaterialHandle {
  return {
    regularMaterial,
    debugMaterials: {
      near: debugMaterial,
      mid: debugMaterial,
      far: debugMaterial,
      impostor: debugMaterial,
    },
    setTime() {},
    updateSettings() {},
    dispose() {},
  } as TreeMaterialHandle;
}
