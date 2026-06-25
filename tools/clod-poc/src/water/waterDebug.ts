// Water debug UI helper. Adds a small lil-gui folder for the fake water clipmap:
// enable toggle, debug render mode, clipmap tint/wireframe, depth-write override,
// and the CLOD edge-ocean preview controls.
//
// The existing CLOD "freeze selection" toggle (state.freeze in main.ts) already
// freezes page selection while water keeps following the camera, because
// WaterClipmap.update runs every frame independent of the freeze flag. No new
// freeze framework is added here, per the water spec.
import type GUI from "lil-gui";
import { type WaterDebugMode, type WaterVisualConfig } from "./waterConfig.js";
import { DEFAULT_EDGE_OCEAN_SETTINGS } from "./waterField.js";

export interface WaterDebugState {
  enabled: boolean;
  mode: WaterDebugMode;
  clipmapTint: boolean;
  wireframe: boolean;
  depthWrite: boolean;
  oceanEnabled: boolean;
  oceanStartDistance: number;
  oceanFullDepthDistance: number;
  oceanMaxDepth: number;
}

export interface WaterDebugBindings {
  onEnabled: (enabled: boolean) => void;
  onMode: (mode: WaterDebugMode) => void;
  onClipmapTint: (enabled: boolean) => void;
  onWireframe: (enabled: boolean) => void;
  onDepthWrite: (depthWrite: boolean) => void;
  onOceanEnabled: (enabled: boolean) => void;
  onOceanStartDistance: (distance: number) => void;
  onOceanFullDepthDistance: (distance: number) => void;
  onOceanMaxDepth: (depth: number) => void;
  onRebuildVisual: () => void;
}

export interface WaterDebugController {
  refreshDisplay: () => void;
}

const WATER_MODE_OPTIONS: Record<string, WaterDebugMode> = {
  "final (0)": "final",
  "depth (1)": "depth",
  "foam (2)": "foam",
  "fresnel (3)": "fresnel",
  "body mask (4)": "bodyMask",
  "clipmap level (5)": "clipmapLevel",
  "flow (6)": "flow",
  "refraction (12)": "refraction",
  "reflection (13)": "reflection",
  "SSR hit (14)": "ssrHit",
};

export function defaultWaterDebugState(visual: WaterVisualConfig): WaterDebugState {
  return {
    enabled: true,
    mode: "final",
    clipmapTint: false,
    wireframe: false,
    depthWrite: visual.depthWrite,
    oceanEnabled: DEFAULT_EDGE_OCEAN_SETTINGS.enabled,
    oceanStartDistance: DEFAULT_EDGE_OCEAN_SETTINGS.startDistance,
    oceanFullDepthDistance: DEFAULT_EDGE_OCEAN_SETTINGS.fullDepthDistance,
    oceanMaxDepth: DEFAULT_EDGE_OCEAN_SETTINGS.maxDepth,
  };
}

export function addWaterDebugFolder(
  gui: GUI,
  state: WaterDebugState,
  bindings: WaterDebugBindings,
): WaterDebugController {
  const folder = gui.addFolder("water");
  folder.add(state, "enabled").name("enabled").onChange((enabled: boolean) => {
    bindings.onEnabled(enabled);
  });
  folder.add(state, "mode", WATER_MODE_OPTIONS).name("debug mode").onChange((key: string) => {
    const mode = WATER_MODE_OPTIONS[key] ?? (Object.values(WATER_MODE_OPTIONS).includes(key as WaterDebugMode) ? key as WaterDebugMode : undefined);
    if (mode) bindings.onMode(mode);
  });
  folder.add(state, "clipmapTint").name("clipmap tint").onChange((enabled: boolean) => {
    bindings.onClipmapTint(enabled);
  });
  folder.add(state, "wireframe").name("wireframe").onChange((enabled: boolean) => {
    bindings.onWireframe(enabled);
  });
  folder.add(state, "depthWrite").name("depth write").onChange((on: boolean) => {
    bindings.onDepthWrite(on);
    bindings.onRebuildVisual();
  });

  const ocean = folder.addFolder("edge ocean");
  ocean.add(state, "oceanEnabled").name("enabled").onChange((enabled: boolean) => {
    bindings.onOceanEnabled(enabled);
  });
  ocean.add(state, "oceanStartDistance", 8, 192, 1).name("start distance").onChange((distance: number) => {
    bindings.onOceanStartDistance(distance);
  });
  ocean.add(state, "oceanFullDepthDistance", 0, 128, 1).name("full depth at").onChange((distance: number) => {
    bindings.onOceanFullDepthDistance(distance);
  });
  ocean.add(state, "oceanMaxDepth", 1, 40, 1).name("max depth").onChange((depth: number) => {
    bindings.onOceanMaxDepth(depth);
  });

  return {
    refreshDisplay: () => {
      folder.controllers.forEach((controller) => controller.updateDisplay());
      ocean.controllers.forEach((controller) => controller.updateDisplay());
    },
  };
}
