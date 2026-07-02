import * as THREE from "three";
import GUI from "lil-gui";
import type { Phase1SceneParams } from "./phase1_scene_types.js";
import type { Phase1DebugMode } from "./phase1_config.js";
import type { BorderCoastOceanConfig } from "../config/borderCoastOceanConfig.js";
import type { SurfBand } from "../water/surfBand.js";
import type { DeepOcean } from "../water/deepOcean.js";
import type { Phase1MutableState, Phase1TerrainActions } from "./phase1_scene_terrain_actions.js";
import { createBorderCoastDebug } from "../debug/borderCoastDebug.js";
import { createClodPageInputDebug } from "../debug/clodPageInputDebug.js";
import { createOceanDebug } from "../debug/oceanDebug.js";

export function setupPhase1Gui(deps: {
  gui: GUI;
  sceneParams: Phase1SceneParams;
  coastConfig: BorderCoastOceanConfig;
  scene: THREE.Scene;
  seed: number;
  surf: SurfBand;
  deepOcean: DeepOcean;
  pageBoundaryGroup: THREE.Group;
  lockedBorderGroup: THREE.Group;
  state: Phase1MutableState;
  actions: Phase1TerrainActions;
}) {
  const { gui, sceneParams, coastConfig, scene, seed, surf, deepOcean, pageBoundaryGroup, lockedBorderGroup, state, actions } = deps;
  if (!sceneParams.coastGui) gui.hide();

  const borderDebug = createBorderCoastDebug({
    gui, scene, config: coastConfig, seed,
    onCoastShapingChanged: (enabled) => { void actions.rebuildTerrainForCoast(enabled); },
  });

  const pageInputDebug = createClodPageInputDebug({
    gui,
    getSelectionStats: () => {
      const trianglesByLod = new Map<number, number>();
      for (const node of state.lastRenderedNodes) {
        trianglesByLod.set(node.level, (trianglesByLod.get(node.level) ?? 0) + node.mesh.indices.length / 3);
      }
      return { selectedNodes: state.lastRenderedNodes.length, trianglesByLod };
    },
    setFreezeLodSelection: (frozen) => { state.freezeLodSelection = frozen; },
    setPageBoundariesVisible: (visible) => {
      pageBoundaryGroup.visible = visible;
      actions.rebuildSelectionOverlays(state.lastRenderedNodes);
    },
    setLockedBorderVisible: (visible) => {
      lockedBorderGroup.visible = visible;
      actions.rebuildSelectionOverlays(state.lastRenderedNodes);
    },
    setPageSourcePurityVisible: (visible) => {
      actions.setTerrainDebugMode(visible ? "page_source_sections" as Phase1DebugMode : sceneParams.debugMode);
    },
    setWaterExclusionVisible: (visible) => {
      (surf.object.material as THREE.Material & { wireframe: boolean }).wireframe = visible;
      surf.object.material.needsUpdate = true;
      deepOcean.object.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (!("wireframe" in material)) continue;
          (material as THREE.Material & { wireframe: boolean }).wireframe = visible;
          material.needsUpdate = true;
        }
      });
    },
  });

  const oceanDebug = createOceanDebug(gui, coastConfig, surf, deepOcean);
  return { borderDebug, pageInputDebug, oceanDebug };
}
