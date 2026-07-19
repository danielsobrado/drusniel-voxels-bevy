import type GUI from "lil-gui";
import { type WaterVisualConfig } from "./waterConfig.js";
import { DEFAULT_SHORE_SURF_BAND_SETTINGS } from "./waterField.js";
import { DEFAULT_HYDROLOGY_CONFIG } from "./hydrologyConfig.js";
import { riverMistInitialEnabled } from "./riverMistRuntime.js";
import type { WaterDebugState, WaterDebugBindings, WaterDebugController } from "./water_debug_types.js";
import {
  WATER_MODE_OPTIONS, querySource, queryBool, queryNumber, reloadWithRiverState,
  addRiverStatsFolder, addCascadeParticleStatsFolder, addRiverEcologyDebugFolder,
  addRiverEcologyTuningFolder, addRiverMaterialTuningFolder, addRiverCascadeParticleTuningFolder,
} from "./water_debug_folders.js";

export type { WaterDebugState, WaterRiverDebugStats, WaterDebugBindings, WaterDebugController } from "./water_debug_types.js";

export function defaultWaterDebugState(visual: WaterVisualConfig): WaterDebugState {
  const riverDefaults = DEFAULT_HYDROLOGY_CONFIG.rivers;
  return {
    enabled: true, mode: "final", clipmapTint: false, wireframe: false,
    depthWrite: visual.depthWrite,
    shoreSurfEnabled: DEFAULT_SHORE_SURF_BAND_SETTINGS.enabled,
    shoreSurfStartDistance: DEFAULT_SHORE_SURF_BAND_SETTINGS.startDistance,
    shoreSurfFullDistance: DEFAULT_SHORE_SURF_BAND_SETTINGS.fullSurfDistance,
    shoreSurfMaxDepth: DEFAULT_SHORE_SURF_BAND_SETTINGS.maxShallowDepth,
    riverSource: querySource("hydrology"),
    riversFallback: queryBool("riversFallback", riverDefaults.guaranteeFallbackRivers),
    riverMain: queryBool("riverMain", riverDefaults.fallbackMainRiver),
    riverTributaries: queryBool("riverTributaries", riverDefaults.fallbackTributaries),
    riverWidth: queryNumber("riverWidth", riverDefaults.widenRadius),
    riverVisibleDepth: queryNumber("riverVisibleDepth", riverDefaults.visibleDepthM),
    riverCarveDepth: queryNumber("riverCarveDepth", riverDefaults.carveDepthM),
    riverFlowSpeed: queryNumber("riverFlowSpeed", riverDefaults.flowSpeedMultiplier),
    riverFoamStrength: queryNumber("riverFoamStrength", visual.foam.riverStrength),
    riverMistEnabled: riverMistInitialEnabled(),
  };
}

export function addWaterDebugFolder(gui: GUI, state: WaterDebugState, bindings: WaterDebugBindings): WaterDebugController {
  const folder = gui.addFolder("water");
  folder.add(state, "enabled").name("enabled").onChange((enabled: boolean) => bindings.onEnabled(enabled));
  folder.add(state, "mode", WATER_MODE_OPTIONS).name("debug mode").onChange((key: string) => {
    const mode = WATER_MODE_OPTIONS[key] ?? (Object.values(WATER_MODE_OPTIONS).includes(key as any) ? key as any : undefined);
    if (mode) bindings.onMode(mode);
  });
  folder.add(state, "clipmapTint").name("clipmap tint").onChange((v: boolean) => bindings.onClipmapTint(v));
  folder.add(state, "wireframe").name("wireframe").onChange((v: boolean) => bindings.onWireframe(v));
  folder.add(state, "depthWrite").name("depth write").onChange((v: boolean) => { bindings.onDepthWrite(v); bindings.onRebuildVisual(); });
  const rivers = folder.addFolder("rivers");
  rivers.add(state, "riverSource", { hydrology: "hydrology", "fake bodies": "fake_bodies" }).name("source");
  rivers.add(state, "riversFallback").name("guarantee rivers");
  rivers.add(state, "riverMain").name("fallback trunk");
  rivers.add(state, "riverTributaries").name("fallback tributaries");
  rivers.add(state, "riverWidth", 0.5, 8, 0.1).name("width / widen");
  rivers.add(state, "riverVisibleDepth", 0.1, 8, 0.1).name("visible depth");
  rivers.add(state, "riverCarveDepth", 0.5, 18, 0.25).name("carve depth");
  rivers.add(state, "riverFlowSpeed", 0.1, 4, 0.05).name("flow speed");
  rivers.add(state, "riverFoamStrength", 0, 2, 0.01).name("rapids foam");
  rivers.add(state, "riverMistEnabled").name("river mist").onChange((enabled: boolean) => bindings.onRiverMistEnabled(enabled));
  rivers.add({ apply: () => reloadWithRiverState(state) }, "apply").name("apply + rebuild");
  const riverStats = addRiverStatsFolder(folder, bindings);
  const cascadeStats = addCascadeParticleStatsFolder(folder, bindings);
  const riverEcologyDebug = addRiverEcologyDebugFolder(folder, state, bindings);
  const riverEcologyTuning = addRiverEcologyTuningFolder(folder);
  const riverMaterialTuning = addRiverMaterialTuningFolder(folder);
  const riverCascadeParticleTuning = addRiverCascadeParticleTuningFolder(folder);
  const shoreSurf = folder.addFolder("shore surf");
  shoreSurf.add(state, "shoreSurfEnabled").name("enabled").onChange((v: boolean) => bindings.onShoreSurfEnabled(v));
  shoreSurf.add(state, "shoreSurfStartDistance", 8, 192, 1).name("start distance").onChange((v: number) => bindings.onShoreSurfStartDistance(v));
  shoreSurf.add(state, "shoreSurfFullDistance", 0, 128, 1).name("full surf at").onChange((v: number) => bindings.onShoreSurfFullDistance(v));
  shoreSurf.add(state, "shoreSurfMaxDepth", 0.1, 8, 0.1).name("max shallow depth").onChange((v: number) => bindings.onShoreSurfMaxDepth(v));
  return {
    refreshDisplay: () => {
      folder.controllers.forEach((c) => c.updateDisplay());
      rivers.controllers.forEach((c) => c.updateDisplay());
      riverStats.refresh();
      cascadeStats.refresh();
      riverEcologyDebug.refresh();
      riverEcologyTuning.refresh();
      riverMaterialTuning.refresh();
      riverCascadeParticleTuning.refresh();
      shoreSurf.controllers.forEach((c) => c.updateDisplay());
    },
  };
}
