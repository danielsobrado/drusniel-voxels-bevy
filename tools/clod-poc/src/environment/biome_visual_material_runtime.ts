import * as THREE from "three";
import type { GrassController } from "../runtime/vegetation/grass_controller.js";
import type { TerrainMaterialHandle } from "../rendering/terrain_material.js";
import type { TerrainMaterialController } from "../terrain/material/terrain_material_controller.js";
import { updateGroundDebrisBiomeState } from "../ecology/dressing/gpu/ground_debris_biome_state.js";
import { installBiomeVisualAcceptanceApi } from "./biome_visual_acceptance_api.js";
import {
  createBiomeVisualMaterialBinding,
  type BiomeMaterialBinding,
  type BiomeMaterialDomain,
} from "./biome_visual_material_shader.js";
import {
  biomeVisualMaterialStateSignature,
  resolveBiomeVisualMaterialState,
} from "./biome_visual_material_state.js";
import { readActiveBiomeVisualState } from "./biome_visual_state_runtime.js";

const MATERIAL_SCAN_INTERVAL_FRAMES = 120;
const VEGETATION_ROOTS: readonly {
  readonly name: string;
  readonly domain: Exclude<BiomeMaterialDomain, "terrain">;
}[] = [
  { name: "grass", domain: "grass" },
  { name: "trees", domain: "tree" },
  { name: "understory", domain: "understory" },
];

const installedControllers = new WeakSet<GrassController>();

export interface BiomeVisualMaterialRoutingInput {
  readonly scene: THREE.Scene;
  readonly materialController: TerrainMaterialController;
  readonly grassController: GrassController;
}

export function installBiomeVisualMaterialRouting(
  input: BiomeVisualMaterialRoutingInput,
): void {
  if (installedControllers.has(input.grassController)) return;
  installedControllers.add(input.grassController);

  const materialBindings = new WeakMap<THREE.Material, BiomeMaterialBinding>();
  const activeBindings = new Set<BiomeMaterialBinding>();
  const terrainHandles = new WeakSet<TerrainMaterialHandle>();
  const uniqueMaterials = new Set<THREE.Material>();
  let frame = 1;
  let current = resolveBiomeVisualMaterialState(readActiveBiomeVisualState());
  updateGroundDebrisBiomeState(current);
  let lastSignature = biomeVisualMaterialStateSignature(current);

  const bindMaterial = (material: THREE.Material, domain: BiomeMaterialDomain): void => {
    if (isDebugMaterial(material)) return;

    const existing = materialBindings.get(material);
    if (existing) {
      activeBindings.add(existing);
      existing.update(current);
      return;
    }

    const binding = createBiomeVisualMaterialBinding(material, domain);
    if (!binding) return;

    materialBindings.set(material, binding);
    activeBindings.add(binding);
    binding.update(current);
    material.addEventListener("dispose", () => activeBindings.delete(binding));
  };

  const bindTerrainHandle = (handle: TerrainMaterialHandle): void => {
    if (terrainHandles.has(handle)) return;
    terrainHandles.add(handle);
    bindMaterial(handle.material, "terrain");
    handle.onMaterialChanged((material) => bindMaterial(material, "terrain"));
  };

  const bindObjectMaterials = (
    object: THREE.Object3D,
    domain: Exclude<BiomeMaterialDomain, "terrain">,
  ): void => {
    uniqueMaterials.clear();
    object.traverse((candidate) => {
      if (!(candidate instanceof THREE.Mesh)) return;
      const materials = Array.isArray(candidate.material) ? candidate.material : [candidate.material];
      for (const material of materials) uniqueMaterials.add(material);
    });
    for (const material of uniqueMaterials) bindMaterial(material, domain);
  };

  const scanVegetationRoot = (
    rootName: string,
    domain: Exclude<BiomeMaterialDomain, "terrain">,
  ): void => {
    const root = findNamedRoot(input.scene, rootName);
    if (root) bindObjectMaterials(root, domain);
  };

  const scanFarCanopyMaterials = (): void => {
    for (const child of input.scene.children) {
      if (child.userData.canopyTextureSetRevision === undefined) continue;
      bindObjectMaterials(child, "tree");
    }
  };

  const scanActiveMaterials = (): void => {
    for (const handle of input.materialController.materials) bindTerrainHandle(handle);
    for (const root of VEGETATION_ROOTS) scanVegetationRoot(root.name, root.domain);
    scanFarCanopyMaterials();
  };

  const tick = (): void => {
    if (frame++ % MATERIAL_SCAN_INTERVAL_FRAMES === 0) scanActiveMaterials();

    const next = resolveBiomeVisualMaterialState(readActiveBiomeVisualState());
    updateGroundDebrisBiomeState(next);
    const signature = biomeVisualMaterialStateSignature(next);
    if (signature === lastSignature) return;

    current = next;
    lastSignature = signature;
    for (const binding of activeBindings) binding.update(current);
  };

  hookTerrainMaterialCreation(input.materialController, bindTerrainHandle, tick);
  hookGrassUpdate(input.grassController, tick);
  scanActiveMaterials();
  if (typeof window !== "undefined") installBiomeVisualAcceptanceApi(input.scene, window);
}

function hookTerrainMaterialCreation(
  controller: TerrainMaterialController,
  bindTerrainHandle: (handle: TerrainMaterialHandle) => void,
  tick: () => void,
): void {
  const makeTerrainMaterial = controller.makeTerrainMaterial.bind(controller);
  controller.makeTerrainMaterial = (color) => {
    const handle = makeTerrainMaterial(color);
    bindTerrainHandle(handle);
    return handle;
  };

  const configureChunkMaterial = controller.configureChunkMaterial.bind(controller);
  controller.configureChunkMaterial = (handle) => {
    configureChunkMaterial(handle);
    bindTerrainHandle(handle);
    tick();
  };
}

function hookGrassUpdate(controller: GrassController, tick: () => void): void {
  const updateGrass = controller.update.bind(controller);
  controller.update = (elapsedSeconds, ringCenter, camera) => {
    tick();
    updateGrass(elapsedSeconds, ringCenter, camera);
  };
}

function findNamedRoot(scene: THREE.Scene, name: string): THREE.Object3D | null {
  return scene.children.find((child) => child.name === name)
    ?? scene.getObjectByName(name)
    ?? null;
}

function isDebugMaterial(material: THREE.Material): boolean {
  return material.name.toLowerCase().includes("debug");
}
