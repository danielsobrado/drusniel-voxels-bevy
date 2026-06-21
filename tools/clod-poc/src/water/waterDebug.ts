// Water debug UI helper. Adds a small lil-gui folder for the fake water clipmap:
// enable toggle, debug render mode, clipmap tint/wireframe, and depth-write override.
//
// The existing CLOD "freeze selection" toggle (state.freeze in main.ts) already
// freezes page selection while water keeps following the camera, because
// WaterClipmap.update runs every frame independent of the freeze flag. No new
// freeze framework is added here, per the water spec.
import type GUI from "lil-gui";
import { type WaterDebugMode, type WaterVisualConfig } from "./waterConfig.js";

export interface WaterDebugState {
  enabled: boolean;
  mode: WaterDebugMode;
  clipmapTint: boolean;
  wireframe: boolean;
  depthWrite: boolean;
}

export interface WaterDebugBindings {
  onEnabled: (enabled: boolean) => void;
  onMode: (mode: WaterDebugMode) => void;
  onClipmapTint: (enabled: boolean) => void;
  onWireframe: (enabled: boolean) => void;
  onDepthWrite: (depthWrite: boolean) => void;
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
};

export function defaultWaterDebugState(visual: WaterVisualConfig): WaterDebugState {
  return {
    enabled: true,
    mode: "final",
    clipmapTint: false,
    wireframe: false,
    depthWrite: visual.depthWrite,
  };
}

export function addWaterDebugFolder(
  gui: GUI,
  state: WaterDebugState,
  bindings: WaterDebugBindings,
): WaterDebugController {
  const folder = gui.addFolder("water (fake clipmap)");
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
  return {
    refreshDisplay: () => {
      folder.controllers.forEach((controller) => controller.updateDisplay());
    },
  };
}
