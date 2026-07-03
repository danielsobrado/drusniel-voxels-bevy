import * as THREE from "three";
import { StorageBufferAttribute, StorageInstancedBufferAttribute } from "three/webgpu";
import { depthPrepassTwin } from "../rendering/veg_prepass.js";
import { isRenderableIndirectDrawGeometry } from "../gpu/indirect_draw_geometry.js";
import {
  gpuBuffersForTier,
  grassGpuRingDrawUnsupportedReason,
  type GrassGpuRingDrawResources,
  type GrassGpuSharedDrawAttributes,
  type GrassGpuTierDrawResources,
  type GrassRingInstanceBuffers,
  type GrassWebGpuBackendAccess,
  type IndirectInstancedBufferGeometry,
} from "./grass_gpu_ring.js";
import { grassGpuRingTierRegion } from "../gpu/grass_ring_compute.js";
import type { GrassShaderMode, GrassTier } from "./grass_config.js";

export function createGrassGpuRingDrawResources(input: {
  candidateCount: number;
  gpuBackend: GrassWebGpuBackendAccess | null;
  geometries: Record<GrassTier, THREE.BufferGeometry>;
  worldCells: number;
  shaderMode: GrassShaderMode;
  useGrassRingDebug: boolean;
  useGrassPrepass: boolean;
  materialFor: (mode: GrassShaderMode) => THREE.Material;
  rebuildInjectedRingMaterial: (buffers: GrassRingInstanceBuffers) => void;
  addPrepassTwin: (twin: THREE.Mesh) => void;
  gpuBufferForAttribute: (attribute: THREE.BufferAttribute) => GPUBuffer;
}): GrassGpuRingDrawResources {
  const {
    candidateCount,
    gpuBackend,
    geometries,
    worldCells,
    shaderMode,
    useGrassRingDebug,
    useGrassPrepass,
    materialFor,
    rebuildInjectedRingMaterial,
    addPrepassTwin,
    gpuBufferForAttribute,
  } = input;
  if (!gpuBackend) throw new Error("Cannot create WebGPU grass draw resources without a backend");
  const count = Math.max(1, candidateCount);
  const sharedInstanceCount = count * 4;
  const indirect = new StorageBufferAttribute(new Uint32Array(4 * 5), 5);
  indirect.name = "grass-ring-indirect";
  gpuBackend.createIndirectStorageAttribute(indirect);
  const sharedAttributes: GrassGpuSharedDrawAttributes = {
    offset: createStorageInstancedAttribute(gpuBackend, "shared-offset", sharedInstanceCount),
    packed0: createStorageInstancedAttribute(gpuBackend, "shared-packed0", sharedInstanceCount),
    packed1: createStorageInstancedAttribute(gpuBackend, "shared-packed1", sharedInstanceCount),
    terrainNormal: createStorageInstancedAttribute(gpuBackend, "shared-terrain-normal", sharedInstanceCount),
  };
  rebuildInjectedRingMaterial({ ...sharedAttributes, capacity: sharedInstanceCount });

  const createTier = (
    tier: GrassTier,
    indirectOffset: number,
  ) => createGpuRingTierDraw({
    tier,
    count,
    bladeGeometry: geometries[tier],
    indirect,
    indirectOffset,
    sharedAttributes,
    worldCells,
    shaderMode,
    useGrassPrepass,
    materialFor,
    addPrepassTwin,
  });
  const tiers: Partial<Record<GrassTier, GrassGpuTierDrawResources>> = {};
  const near = createTier("near", 0);
  if (near) tiers.near = near;
  const mid = createTier("mid", 5 * Uint32Array.BYTES_PER_ELEMENT);
  if (mid) tiers.mid = mid;
  const far = createTier("far", 10 * Uint32Array.BYTES_PER_ELEMENT);
  if (far) tiers.far = far;
  const superTier = createTier("super", 15 * Uint32Array.BYTES_PER_ELEMENT);
  if (superTier) tiers.super = superTier;
  if (useGrassRingDebug) logGpuRingRegions(count);

  return {
    tiers,
    indirect,
    outputBuffers: {
      near: gpuBuffersForTier(sharedAttributes, gpuBufferForAttribute),
      mid: gpuBuffersForTier(sharedAttributes, gpuBufferForAttribute),
      far: gpuBuffersForTier(sharedAttributes, gpuBufferForAttribute),
      super: gpuBuffersForTier(sharedAttributes, gpuBufferForAttribute),
      indirectArgs: gpuBufferForAttribute(indirect),
    },
  };
}

function createGpuRingTierDraw(input: {
  tier: GrassTier;
  count: number;
  bladeGeometry: THREE.BufferGeometry;
  indirect: StorageBufferAttribute;
  indirectOffset: number;
  sharedAttributes: GrassGpuSharedDrawAttributes;
  worldCells: number;
  shaderMode: GrassShaderMode;
  useGrassPrepass: boolean;
  materialFor: (mode: GrassShaderMode) => THREE.Material;
  addPrepassTwin: (twin: THREE.Mesh) => void;
}): GrassGpuTierDrawResources | null {
  const { tier, count, bladeGeometry, indirect, indirectOffset, sharedAttributes, worldCells, shaderMode, useGrassPrepass, materialFor, addPrepassTwin } = input;
  if (!isRenderableIndirectDrawGeometry(bladeGeometry)) return null;
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", bladeGeometry.getAttribute("position"));
  geometry.setAttribute("uv", bladeGeometry.getAttribute("uv"));
  geometry.setAttribute("normal", bladeGeometry.getAttribute("normal"));
  geometry.setIndex(bladeGeometry.getIndex());
  const { offset, packed0, packed1, terrainNormal } = sharedAttributes;
  geometry.instanceCount = count;
  setGpuRingIndirect(geometry, indirect, indirectOffset);
  geometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(-1, -1, -1),
    new THREE.Vector3(worldCells + 1, 256, worldCells + 1),
  );
  geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
  const mesh = new THREE.Mesh(geometry, materialFor(shaderMode));
  mesh.name = `grass-ring-gpu-${tier}`;
  mesh.frustumCulled = false;
  if (useGrassPrepass && (tier === "near" || tier === "mid")) {
    const materialNodes = mesh.material as unknown as { positionNode?: unknown; maskNode?: unknown };
    if (materialNodes.positionNode) {
      addPrepassTwin(depthPrepassTwin(mesh, {
        positionNode: materialNodes.positionNode,
        maskNode: materialNodes.maskNode,
        side: THREE.DoubleSide,
      }));
    }
  }
  return { mesh, offset, packed0, packed1, terrainNormal };
}

function createStorageInstancedAttribute(
  gpuBackend: GrassWebGpuBackendAccess,
  name: string,
  count: number,
): StorageInstancedBufferAttribute {
  const attribute = new StorageInstancedBufferAttribute(count, 4);
  attribute.name = `grass-ring-${name}`;
  gpuBackend.createStorageAttribute(attribute);
  return attribute;
}

function setGpuRingIndirect(
  geometry: THREE.InstancedBufferGeometry,
  indirect: StorageBufferAttribute,
  indirectOffset: number,
): void {
  const indirectGeometry = geometry as IndirectInstancedBufferGeometry;
  if (!indirectGeometry.setIndirect) {
    throw new Error(grassGpuRingDrawUnsupportedReason() ?? "Missing WebGPU indirect geometry support");
  }
  indirectGeometry.setIndirect(indirect, indirectOffset);
}

function logGpuRingRegions(maxInstancesPerTier: number): void {
  const rows = (["near", "mid", "far", "super"] as const).map((tier, index) => ({
    tier,
    ...grassGpuRingTierRegion(index, maxInstancesPerTier),
  }));
  console.info("[grass-ring-debug] compact tier regions", rows);
}
