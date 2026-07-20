import type * as THREE from "three";
import type { ClodHooks } from "../../core/hooks.js";
import type { CustomPropsSettings, PropPlacementScene } from "../../props/prop_types.js";
import { parseCustomPropsConfig } from "../../props/prop_config.js";
import { loadDefaultExternalPropCatalog } from "../../props/default_external_prop_catalog.js";
import { parsePropPlacements, resolvePropPlacementScene } from "../../props/prop_placements.js";
import type { PropStats } from "../../props/prop_stats.js";
import { createPropController, type PropController } from "../../systems/prop_controller.js";
import type { PropEditStore } from "../../project/prop_edit_store.js";
import { propPlacementSceneToProjectProps } from "../../project/project_props.js";
import { surfaceHeight } from "../../terrain/terrain.js";
import type { VegetationGpuBackend } from "../../runtime/vegetation/vegetation_gpu_backend.js";

export interface CustomPropsStartupInput {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  customPropsConfig: CustomPropsSettings;
  placementScene: PropPlacementScene;
  enabled: boolean;
  searchParams?: URLSearchParams;
  getHooks: () => ClodHooks | null;
  propEditStore?: PropEditStore;
  onStats?: (stats: PropStats) => void;
  gpuDevice?: GPUDevice | null;
  gpuBackend?: VegetationGpuBackend | null;
}

export interface CustomPropsStartupResult {
  propController: PropController;
  propStats: { current: PropStats | null };
  stopPropStoreSync: () => void;
}

function installCustomPropQaHooks(input: CustomPropsStartupInput, propController: PropController): void {
  const hooks = input.getHooks();
  if (!hooks) return;

  hooks.getCustomPropPlacementSnapshot = () => propController.getPlacementSceneSnapshot();
  hooks.replaceTerrainAnchoredCustomProps = (instances) => {
    const available = new Set(propController.availablePrefabIds());
    const invalid = instances.find((instance) => !available.has(instance.assetId));
    if (invalid) throw new Error(`Unknown custom prop asset: ${invalid.assetId}`);

    const placementScene: PropPlacementScene = {
      schemaVersion: 1,
      sceneId: "qa-terrain-anchored",
      instances: instances.map((instance, index) => ({
        assetId: instance.assetId,
        position: [instance.x, surfaceHeight(instance.x, instance.z), instance.z],
        rotationY: instance.rotationY ?? 0,
        scale: instance.scale ?? 1,
        seed: instance.seed ?? index,
        variationId: instance.variationId ?? index,
        flags: 0,
        revision: 0,
      })),
    };

    if (input.propEditStore) {
      input.propEditStore.restore(propPlacementSceneToProjectProps(placementScene));
    } else {
      propController.replacePlacementScene(placementScene);
    }
    return propController.getPlacementSceneSnapshot();
  };
}

export async function runCustomPropsStartup(
  input: CustomPropsStartupInput,
): Promise<CustomPropsStartupResult | null> {
  const externalSettings = await loadDefaultExternalPropCatalog(input.customPropsConfig);
  if (!input.enabled || externalSettings.props.length === 0) return null;

  const settings: CustomPropsSettings = {
    ...externalSettings,
    enabled: true,
    debug: { ...externalSettings.debug },
    gpu: { ...externalSettings.gpu },
  };
  if (input.searchParams?.get("customPropsGpuRing") === "1") settings.gpu.enabled = true;
  if (input.searchParams?.get("customPropsGpuRing") === "0") settings.gpu.enabled = false;
  if (input.searchParams?.get("customPropsGpuForceCpu") === "1") settings.gpu.debugForceCpu = true;
  if (input.searchParams?.get("customPropsDebug") === "1") {
    settings.debug = {
      showCells: true,
      showBounds: true,
      lodColorOverlay: true,
      billboardOverlay: true,
    };
  }

  const propStats = { current: null as PropStats | null };
  const propController = createPropController({
    scene: input.scene,
    settings,
    placementScene: input.placementScene,
    getHooks: input.getHooks,
    gpuDevice: input.gpuDevice,
    gpuBackend: input.gpuBackend,
    syncStatsToState: (stats) => {
      propStats.current = stats;
      input.onStats?.(stats);
    },
  });

  await propController.init();
  const stopPropStoreSync = input.propEditStore?.subscribe(() => {
    if (!input.propEditStore) return;
    propController.replacePlacementScene(input.propEditStore.toPlacementScene("active"));
  }) ?? (() => undefined);
  installCustomPropQaHooks(input, propController);
  return { propController, propStats, stopPropStoreSync };
}

export function resolveCustomPropsEnabled(
  searchParams: URLSearchParams,
  config: CustomPropsSettings,
): boolean {
  if (searchParams.get("customProps") === "1") return true;
  if (searchParams.get("customProps") === "0") return false;
  return config.enabled;
}

export { parseCustomPropsConfig, parsePropPlacements, resolvePropPlacementScene };
