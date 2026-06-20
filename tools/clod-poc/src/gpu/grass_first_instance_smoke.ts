// Manual WebGPU browser smoke test for the grass-ring draw contract.
// Run with ?grassFirstInstanceSmoke=1. This intentionally bypasses terrain and normal grass
// placement, but uses the same StorageBufferAttribute + StorageInstancedBufferAttribute +
// setIndirect + storage().element(instanceIndex) pattern as webgpu-ring-v1.

import * as THREE from "three";
import {
  MeshBasicNodeMaterial,
  StorageBufferAttribute,
  StorageInstancedBufferAttribute,
  WebGPURenderer,
} from "three/webgpu";
import { instanceIndex, positionGeometry, storage } from "three/tsl";

const TIERS = ["near", "mid", "far", "super"] as const;
type SmokeTier = typeof TIERS[number];
const INDIRECT_ARGS_PER_TIER = 5;

interface SmokeBackend {
  createStorageAttribute(attribute: THREE.BufferAttribute): void;
  createIndirectStorageAttribute(attribute: THREE.BufferAttribute): void;
}

export interface GrassFirstInstanceSmokeRegion {
  tier: SmokeTier;
  start: number;
  end: number;
  firstInstance: number;
}

export function grassFirstInstanceSmokeRegions(maxInstancesPerTier: number): GrassFirstInstanceSmokeRegion[] {
  const count = Math.max(0, Math.floor(maxInstancesPerTier));
  return TIERS.map((tier, index) => {
    const start = index * count;
    return {
      tier,
      start,
      end: start + count,
      firstInstance: start,
    };
  });
}

export async function runGrassFirstInstanceSmoke(): Promise<void> {
  document.body.replaceChildren();
  document.body.style.margin = "0";
  document.body.style.background = "#101416";
  document.body.style.overflow = "hidden";

  const renderer = new WebGPURenderer({ antialias: true });
  await renderer.init();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101416);
  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 50);
  camera.position.set(0, 0, 8);
  camera.lookAt(0, 0, 0);

  const maxInstancesPerTier = 4;
  const sharedInstanceCount = maxInstancesPerTier * TIERS.length;
  const regions = grassFirstInstanceSmokeRegions(maxInstancesPerTier);
  const offsets = new StorageInstancedBufferAttribute(sharedInstanceCount, 4);
  offsets.name = "grass-first-instance-smoke-offset";
  const colors = new StorageInstancedBufferAttribute(sharedInstanceCount, 4);
  colors.name = "grass-first-instance-smoke-color";
  fillSmokeStorage(offsets.array as Float32Array, colors.array as Float32Array, regions);

  const indirect = new StorageBufferAttribute(new Uint32Array(TIERS.length * INDIRECT_ARGS_PER_TIER), INDIRECT_ARGS_PER_TIER);
  indirect.name = "grass-first-instance-smoke-indirect";

  const base = new THREE.PlaneGeometry(1, 1);
  const indexCount = base.getIndex()?.count ?? 0;
  const indirectArgs = indirect.array as Uint32Array;
  for (let i = 0; i < regions.length; i++) {
    const baseArg = i * INDIRECT_ARGS_PER_TIER;
    indirectArgs[baseArg] = indexCount;
    indirectArgs[baseArg + 1] = 1;
    indirectArgs[baseArg + 2] = 0;
    indirectArgs[baseArg + 3] = 0;
    indirectArgs[baseArg + 4] = regions[i].firstInstance;
  }

  const backend = renderer.backend as unknown as SmokeBackend;
  backend.createStorageAttribute(offsets);
  backend.createStorageAttribute(colors);
  backend.createIndirectStorageAttribute(indirect);

  const material = createSmokeMaterial(offsets, colors, sharedInstanceCount);
  for (let i = 0; i < regions.length; i++) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("position", base.getAttribute("position"));
    geometry.setAttribute("uv", base.getAttribute("uv"));
    geometry.setIndex(base.getIndex());
    geometry.instanceCount = maxInstancesPerTier;
    (geometry as unknown as {
      setIndirect(attribute: THREE.BufferAttribute, offset: number): void;
    }).setIndirect(indirect, i * INDIRECT_ARGS_PER_TIER * Uint32Array.BYTES_PER_ELEMENT);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `grass-first-instance-smoke-${regions[i].tier}`;
    mesh.frustumCulled = false;
    scene.add(mesh);
  }
  base.dispose();

  const label = document.createElement("div");
  label.textContent = "grass firstInstance smoke";
  label.style.position = "fixed";
  label.style.left = "12px";
  label.style.bottom = "12px";
  label.style.color = "#d8ede4";
  label.style.font = "13px system-ui, sans-serif";
  document.body.appendChild(label);

  console.info("[grass-first-instance-smoke] ready");
  console.info("[grass-first-instance-smoke] firstInstance regions: "
    + regions.map((region) => `${region.tier}=${region.firstInstance}`).join(" "));

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  renderer.setAnimationLoop(() => {
    renderer.render(scene, camera);
  });
}

function createSmokeMaterial(
  offsets: StorageInstancedBufferAttribute,
  colors: StorageInstancedBufferAttribute,
  capacity: number,
): MeshBasicNodeMaterial {
  const offsetStore = storage(offsets, "vec4", capacity).toReadOnly();
  const colorStore = storage(colors, "vec4", capacity).toReadOnly();
  const offset = offsetStore.element(instanceIndex);
  const color = colorStore.element(instanceIndex);
  const material = new MeshBasicNodeMaterial();
  material.positionNode = positionGeometry.mul(offset.w).add(offset.xyz);
  material.colorNode = color.xyz;
  material.side = THREE.DoubleSide;
  return material;
}

function fillSmokeStorage(
  offsets: Float32Array,
  colors: Float32Array,
  regions: readonly GrassFirstInstanceSmokeRegion[],
): void {
  const xByTier: Record<SmokeTier, number> = { near: -2.7, mid: -0.9, far: 0.9, super: 2.7 };
  const colorByTier: Record<SmokeTier, [number, number, number]> = {
    near: [0.1, 0.85, 0.25],
    mid: [0.15, 0.55, 1.0],
    far: [1.0, 0.78, 0.12],
    super: [0.98, 0.22, 0.35],
  };
  for (const region of regions) {
    const slot = region.firstInstance * 4;
    offsets[slot] = xByTier[region.tier];
    offsets[slot + 1] = 0;
    offsets[slot + 2] = 0;
    offsets[slot + 3] = 1.35;
    const color = colorByTier[region.tier];
    colors[slot] = color[0];
    colors[slot + 1] = color[1];
    colors[slot + 2] = color[2];
    colors[slot + 3] = 1;
  }
}
