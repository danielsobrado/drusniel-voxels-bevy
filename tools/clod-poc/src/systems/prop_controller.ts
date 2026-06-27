import type * as THREE from "three";
import type { CustomPropsSettings, PropPlacementScene } from "../props/prop_types.js";
import { PropColliderSet } from "../props/prop_collider.js";
import { PropSystem } from "../props/prop_system.js";
import type { PropStats } from "../props/prop_stats.js";
import type { ClodHooks } from "../core/hooks.js";

export interface PropControllerDeps {
  scene: THREE.Scene;
  settings: CustomPropsSettings;
  placementScene: PropPlacementScene;
  getHooks?: () => ClodHooks | null;
  syncStatsToState?: (stats: PropStats) => void;
}

export interface PropController {
  readonly system: PropSystem;
  readonly colliderSet: PropColliderSet;
  init(): Promise<void>;
  update(camera: THREE.PerspectiveCamera): void;
  syncColliders(playerPos: [number, number, number]): void;
  setEnabled(enabled: boolean): void;
  refreshStats(): void;
  getPlacementSceneSnapshot(): PropPlacementScene;
  replacePlacementScene(scene: PropPlacementScene): void;
  availablePrefabIds(): string[];
  dispose(): void;
}

export function createPropController(deps: PropControllerDeps): PropController {
  const system = new PropSystem({
    scene: deps.scene,
    settings: { ...deps.settings },
    placementScene: deps.placementScene,
    getHooks: deps.getHooks,
  });
  const colliderSet = new PropColliderSet();

  const refreshStats = () => {
    deps.syncStatsToState?.(system.getStats());
  };

  return {
    system,
    colliderSet,
    async init() {
      await system.init();
      refreshStats();
    },
    update(camera) {
      system.update(camera);
      refreshStats();
    },
    syncColliders(playerPos) {
      const instances = system.buildColliderInstances(playerPos);
      colliderSet.sync(instances);
      system.setCollidersActive(colliderSet.activeCount());
    },
    setEnabled(enabled) {
      system.setEnabled(enabled);
      refreshStats();
    },
    refreshStats,
    getPlacementSceneSnapshot() {
      return system.getPlacementSceneSnapshot();
    },
    replacePlacementScene(scene) {
      system.replacePlacementScene(scene);
      refreshStats();
    },
    availablePrefabIds() {
      return system.availablePrefabIds();
    },
    dispose() {
      colliderSet.dispose();
      system.dispose();
    },
  };
}
