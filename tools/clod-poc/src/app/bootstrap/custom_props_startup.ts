import type * as THREE from "three";
import type { ClodHooks } from "../../core/hooks.js";
import type { CustomPropsSettings, PropPlacementScene } from "../../props/prop_types.js";
import { parseCustomPropsConfig } from "../../props/prop_config.js";
import { parsePropPlacements, resolvePropPlacementScene } from "../../props/prop_placements.js";
import type { PropStats } from "../../props/prop_stats.js";
import { createPropController, type PropController } from "../../systems/prop_controller.js";
import type { PropEditStore } from "../../project/prop_edit_store.js";

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
}

export interface CustomPropsStartupResult {
  propController: PropController;
  propStats: { current: PropStats | null };
  stopPropStoreSync: () => void;
}

export async function runCustomPropsStartup(
  input: CustomPropsStartupInput,
): Promise<CustomPropsStartupResult | null> {
  if (!input.enabled || input.customPropsConfig.props.length === 0) return null;

  const settings: CustomPropsSettings = {
    ...input.customPropsConfig,
    enabled: true,
    debug: { ...input.customPropsConfig.debug },
  };
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
