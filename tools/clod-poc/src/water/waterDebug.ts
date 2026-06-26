// Water debug UI helper. Adds a small lil-gui folder for the fake water clipmap:
// enable toggle, debug render mode, clipmap tint/wireframe, depth-write override,
// and the CLOD shore-surf preview controls.
//
// The existing CLOD "freeze selection" toggle (state.freeze in main.ts) already
// freezes page selection while water keeps following the camera, because
// WaterClipmap.update runs every frame independent of the freeze flag. No new
// freeze framework is added here, per the water spec.
import type GUI from "lil-gui";
import { type WaterDebugMode, type WaterVisualConfig, WATER_DEBUG_MODES } from "./waterConfig.js";
import { DEFAULT_SHORE_SURF_BAND_SETTINGS } from "./waterField.js";

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

const WATER_DEBUG_LABELS: Record<WaterDebugMode, string> = {
  final: "final",
  depth: "depth",
  foam: "foam",
  fresnel: "fresnel",
  bodyMask: "body mask",
  clipmapLevel: "clipmap level",
  flow: "flow",
  hydrologyFill: "hydrology fill",
  accumulation: "accumulation",
  carvedBed: "carved bed",
  waterY: "water Y",
  classification: "classification",
  refraction: "refraction",
  reflection: "reflection",
  ssrHit: "SSR hit",
};

const WATER_MODE_OPTIONS = Object.fromEntries(
  Object.entries(WATER_DEBUG_MODES).map(([mode, id]) => [
    `${WATER_DEBUG_LABELS[mode as WaterDebugMode]} (${id})`,
    mode,
  ]),
) as Record<string, WaterDebugMode>;

export function defaultWaterDebugState(visual: WaterVisualConfig): WaterDebugState {
  return {
    enabled: true,
    mode: "final",
    clipmapTint: false,
    wireframe: false,
    depthWrite: visual.depthWrite,
    oceanEnabled: DEFAULT_SHORE_SURF_BAND_SETTINGS.enabled,
    oceanStartDistance: DEFAULT_SHORE_SURF_BAND_SETTINGS.startDistance,
    oceanFullDepthDistance: DEFAULT_SHORE_SURF_BAND_SETTINGS.fullSurfDistance,
    oceanMaxDepth: DEFAULT_SHORE_SURF_BAND_SETTINGS.maxShallowDepth,
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

  const shoreSurf = folder.addFolder("shore surf");
  shoreSurf.add(state, "oceanEnabled").name("enabled").onChange((enabled: boolean) => {
    bindings.onOceanEnabled(enabled);
  });
  shoreSurf.add(state, "oceanStartDistance", 8, 192, 1).name("start distance").onChange((distance: number) => {
    bindings.onOceanStartDistance(distance);
  });
  shoreSurf.add(state, "oceanFullDepthDistance", 0, 128, 1).name("full surf at").onChange((distance: number) => {
    bindings.onOceanFullDepthDistance(distance);
  });
  shoreSurf.add(state, "oceanMaxDepth", 0.1, 8, 0.1).name("max shallow depth").onChange((depth: number) => {
    bindings.onOceanMaxDepth(depth);
  });

  return {
    refreshDisplay: () => {
      folder.controllers.forEach((controller) => controller.updateDisplay());
      shoreSurf.controllers.forEach((controller) => controller.updateDisplay());
    },
  };
}
