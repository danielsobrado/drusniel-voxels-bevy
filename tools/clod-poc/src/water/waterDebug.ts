// Water debug UI helper. Adds lil-gui folders for water debug, shore surf,
// river tuning, live river stats, and river ecology inspection. River generation
// and ecology/material controls rebuild through URL params because hydrology/GPU
// scatter/water materials are built before the renderer starts.
import type GUI from "lil-gui";
import { type WaterDebugMode, type WaterVisualConfig, WATER_DEBUG_MODES } from "./waterConfig.js";
import { DEFAULT_SHORE_SURF_BAND_SETTINGS } from "./waterField.js";
import { DEFAULT_HYDROLOGY_CONFIG } from "./hydrologyConfig.js";
import {
  readRiverEcologySettings,
  reloadWithRiverEcologySettings,
  riverEcologyReadout,
  type RiverEcologySettings,
} from "./riverEcologyRuntime.js";
import {
  readRiverMaterialSettings,
  reloadWithRiverMaterialSettings,
  type RiverMaterialSettings,
} from "./riverMaterialRuntime.js";

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
  riverSource: "hydrology" | "fake_bodies";
  riversFallback: boolean;
  riverMain: boolean;
  riverTributaries: boolean;
  riverWidth: number;
  riverVisibleDepth: number;
  riverCarveDepth: number;
  riverFlowSpeed: number;
  riverFoamStrength: number;
}

export interface WaterRiverDebugStats {
  source: string;
  hydrologyEnabled: boolean;
  riverCells: number;
  lakeCells: number;
  wetCells: number;
  maxFlowSpeed: number;
  fallbackRivers: boolean;
  fallbackMainRiver: boolean;
  fallbackTributaries: boolean;
  widenRadius: number;
  carveDepthM: number;
  visibleDepthM: number;
  flowSpeedMultiplier: number;
  fakeRiverCount: number;
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
  getRiverStats?: () => WaterRiverDebugStats;
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

function currentSearchParams(): URLSearchParams {
  return typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
}

function queryBool(key: string, fallback: boolean): boolean {
  const raw = currentSearchParams().get(key);
  if (raw === null) return fallback;
  return raw === "1" || raw === "true";
}

function queryNumber(key: string, fallback: number): number {
  const raw = currentSearchParams().get(key);
  if (raw === null) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function querySource(fallback: "hydrology" | "fake_bodies"): "hydrology" | "fake_bodies" {
  const raw = currentSearchParams().get("waterSource");
  return raw === "fake_bodies" ? "fake_bodies" : raw === "hydrology" ? "hydrology" : fallback;
}

function reloadWithRiverState(state: WaterDebugState): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("waterSource", state.riverSource);
  url.searchParams.set("riversFallback", state.riversFallback ? "1" : "0");
  url.searchParams.set("riverMain", state.riverMain ? "1" : "0");
  url.searchParams.set("riverTributaries", state.riverTributaries ? "1" : "0");
  url.searchParams.set("riverWidth", state.riverWidth.toFixed(2));
  url.searchParams.set("riverVisibleDepth", state.riverVisibleDepth.toFixed(2));
  url.searchParams.set("riverCarveDepth", state.riverCarveDepth.toFixed(2));
  url.searchParams.set("riverFlowSpeed", state.riverFlowSpeed.toFixed(2));
  url.searchParams.set("riverFoamStrength", state.riverFoamStrength.toFixed(2));
  window.location.assign(url.toString());
}

function makeEmptyRiverStats(): WaterRiverDebugStats {
  return {
    source: "unknown",
    hydrologyEnabled: false,
    riverCells: 0,
    lakeCells: 0,
    wetCells: 0,
    maxFlowSpeed: 0,
    fallbackRivers: false,
    fallbackMainRiver: false,
    fallbackTributaries: false,
    widenRadius: 0,
    carveDepthM: 0,
    visibleDepthM: 0,
    flowSpeedMultiplier: 1,
    fakeRiverCount: 0,
  };
}

function setWaterDebugMode(state: WaterDebugState, bindings: WaterDebugBindings, mode: WaterDebugMode): void {
  state.mode = mode;
  bindings.onMode(mode);
}

function addRiverStatsFolder(parent: GUI, bindings: WaterDebugBindings): { refresh: () => void } {
  const folder = parent.addFolder("river stats");
  const stats = makeEmptyRiverStats();
  const refresh = () => Object.assign(stats, bindings.getRiverStats?.() ?? makeEmptyRiverStats());
  refresh();
  folder.add(stats, "source").name("source").disable();
  folder.add(stats, "hydrologyEnabled").name("hydrology").disable();
  folder.add(stats, "riverCells").name("river cells").disable();
  folder.add(stats, "lakeCells").name("lake cells").disable();
  folder.add(stats, "wetCells").name("wet cells").disable();
  folder.add(stats, "maxFlowSpeed").name("max flow").disable();
  folder.add(stats, "fallbackRivers").name("fallback used").disable();
  folder.add(stats, "fallbackMainRiver").name("trunk enabled").disable();
  folder.add(stats, "fallbackTributaries").name("tributaries").disable();
  folder.add(stats, "widenRadius").name("width / widen").disable();
  folder.add(stats, "carveDepthM").name("carve depth").disable();
  folder.add(stats, "visibleDepthM").name("visible depth").disable();
  folder.add(stats, "flowSpeedMultiplier").name("flow speed x").disable();
  folder.add(stats, "fakeRiverCount").name("fake rivers").disable();
  folder.add({ refresh }, "refresh").name("refresh stats");
  return {
    refresh: () => {
      refresh();
      folder.controllers.forEach((controller) => controller.updateDisplay());
    },
  };
}

function addRiverEcologyDebugFolder(
  parent: GUI,
  state: WaterDebugState,
  bindings: WaterDebugBindings,
): { refresh: () => void } {
  const folder = parent.addFolder("river ecology debug");
  const actions = {
    showClassification: () => setWaterDebugMode(state, bindings, "classification"),
    showCarvedBed: () => setWaterDebugMode(state, bindings, "carvedBed"),
    showWaterY: () => setWaterDebugMode(state, bindings, "waterY"),
    showFlow: () => setWaterDebugMode(state, bindings, "flow"),
    showFoam: () => setWaterDebugMode(state, bindings, "foam"),
    showFinal: () => setWaterDebugMode(state, bindings, "final"),
  };
  folder.add(actions, "showClassification").name("show classification");
  folder.add(actions, "showCarvedBed").name("show carved bed");
  folder.add(actions, "showWaterY").name("show water Y");
  folder.add(actions, "showFlow").name("show flow");
  folder.add(actions, "showFoam").name("show foam");
  folder.add(actions, "showFinal").name("back to final");

  const readout = riverEcologyReadout();
  folder.add(readout, "grass").name("grass bands").disable();
  folder.add(readout, "understory").name("understory bands").disable();
  folder.add(readout, "trees").name("tree bands").disable();
  folder.add(readout, "stones").name("stone bands").disable();

  return {
    refresh: () => {
      Object.assign(readout, riverEcologyReadout());
      folder.controllers.forEach((controller) => controller.updateDisplay());
    },
  };
}

function addRiverEcologyTuningFolder(parent: GUI): { refresh: () => void } {
  const folder = parent.addFolder("river ecology tuning");
  const settings: RiverEcologySettings = readRiverEcologySettings();
  folder.add(settings, "grassClearanceM", 0.05, 2.5, 0.05).name("grass clear m");
  folder.add(settings, "grassLowStartM", 0.1, 6.0, 0.1).name("grass low start");
  folder.add(settings, "grassLowEndM", 0.5, 12.0, 0.1).name("grass low end");
  folder.add(settings, "grassMoistStartM", 0.5, 16.0, 0.1).name("grass moist start");
  folder.add(settings, "grassMoistEndM", 2.0, 32.0, 0.5).name("grass moist end");
  folder.add(settings, "understoryClearM", 0.05, 3.0, 0.05).name("understory clear");
  folder.add(settings, "understoryFernStartM", 0.2, 8.0, 0.1).name("fern start");
  folder.add(settings, "understoryFernEndM", 2.0, 18.0, 0.5).name("fern end");
  folder.add(settings, "understoryShrubStartM", 2.0, 18.0, 0.5).name("shrub start");
  folder.add(settings, "understoryShrubEndM", 6.0, 36.0, 0.5).name("shrub end");
  folder.add(settings, "treeClearanceM", 0.5, 8.0, 0.1).name("tree clear");
  folder.add(settings, "treeInnerEndM", 2.0, 24.0, 0.5).name("tree inner end");
  folder.add(settings, "treeOuterStartM", 4.0, 40.0, 0.5).name("tree outer start");
  folder.add(settings, "treeOuterEndM", 12.0, 80.0, 1.0).name("tree outer end");
  folder.add(settings, "stoneClearanceM", 0.02, 2.0, 0.02).name("stone clear");
  folder.add({ apply: () => reloadWithRiverEcologySettings(settings) }, "apply").name("apply + rebuild");
  return {
    refresh: () => folder.controllers.forEach((controller) => controller.updateDisplay()),
  };
}

function addRiverMaterialTuningFolder(parent: GUI): { refresh: () => void } {
  const folder = parent.addFolder("river material tuning");
  const settings: RiverMaterialSettings = readRiverMaterialSettings();
  folder.add(settings, "geometryThalwegDip", 0, 0.35, 0.005).name("thalweg dip");
  folder.add(settings, "geometryBankLift", 0, 0.25, 0.005).name("bank lift");
  folder.add(settings, "geometryRiffleStrength", 0, 0.30, 0.005).name("riffle strength");
  folder.add(settings, "geometrySideRiffleStrength", 0, 0.20, 0.005).name("side riffle");
  folder.add(settings, "geometryMaxOffset", 0, 0.60, 0.01).name("max geom offset");
  folder.add(settings, "cascadeDropStart", 0, 8, 0.05).name("cascade drop start");
  folder.add(settings, "cascadeDropEnd", 0.05, 16, 0.05).name("cascade drop end");
  folder.add(settings, "cascadeStepStrength", 0, 0.60, 0.005).name("cascade step");
  folder.add(settings, "cascadeRoughnessStrength", 0, 0.40, 0.005).name("cascade roughness");
  folder.add(settings, "cascadeWhitewaterBoost", 0, 5, 0.05).name("whitewater boost");
  folder.add(settings, "wetBankStrength", 0, 2, 0.05).name("wet bank decals");
  folder.add(settings, "wetBankDistanceM", 0.5, 24, 0.5).name("wet bank distance");
  folder.add(settings, "wetRockDarkening", 0, 1, 0.02).name("wet rock darken");
  folder.add(settings, "foamResidueStrength", 0, 2, 0.05).name("foam residue");
  folder.add(settings, "foamResidueDropStart", 0, 8, 0.05).name("residue drop start");
  folder.add(settings, "flowNormalStrength", 0, 4, 0.05).name("flow normal");
  folder.add(settings, "crossCurrentStrength", 0, 4, 0.05).name("cross current");
  folder.add(settings, "rapidNormalBoost", 0, 4, 0.05).name("rapid normal");
  folder.add(settings, "bankFoamStrength", 0, 3, 0.05).name("bank foam");
  folder.add(settings, "rapidFoamStrength", 0, 3, 0.05).name("rapid foam");
  folder.add(settings, "foamStreakStrength", 0, 3, 0.05).name("foam streaks");
  folder.add(settings, "shallowBankTintStrength", 0, 3, 0.05).name("shallow tint");
  folder.add(settings, "centerChannelDarkening", 0, 3, 0.05).name("center darken");
  folder.add({ apply: () => reloadWithRiverMaterialSettings(settings) }, "apply").name("apply + rebuild");
  return {
    refresh: () => folder.controllers.forEach((controller) => controller.updateDisplay()),
  };
}

export function defaultWaterDebugState(visual: WaterVisualConfig): WaterDebugState {
  const riverDefaults = DEFAULT_HYDROLOGY_CONFIG.rivers;
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
    riverSource: querySource("hydrology"),
    riversFallback: queryBool("riversFallback", riverDefaults.guaranteeFallbackRivers),
    riverMain: queryBool("riverMain", riverDefaults.fallbackMainRiver),
    riverTributaries: queryBool("riverTributaries", riverDefaults.fallbackTributaries),
    riverWidth: queryNumber("riverWidth", riverDefaults.widenRadius),
    riverVisibleDepth: queryNumber("riverVisibleDepth", riverDefaults.visibleDepthM),
    riverCarveDepth: queryNumber("riverCarveDepth", riverDefaults.carveDepthM),
    riverFlowSpeed: queryNumber("riverFlowSpeed", riverDefaults.flowSpeedMultiplier),
    riverFoamStrength: queryNumber("riverFoamStrength", visual.foam.riverStrength),
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
  rivers.add({ apply: () => reloadWithRiverState(state) }, "apply").name("apply + rebuild");

  const riverStats = addRiverStatsFolder(folder, bindings);
  const riverEcologyDebug = addRiverEcologyDebugFolder(folder, state, bindings);
  const riverEcologyTuning = addRiverEcologyTuningFolder(folder);
  const riverMaterialTuning = addRiverMaterialTuningFolder(folder);

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
      rivers.controllers.forEach((controller) => controller.updateDisplay());
      riverStats.refresh();
      riverEcologyDebug.refresh();
      riverEcologyTuning.refresh();
      riverMaterialTuning.refresh();
      shoreSurf.controllers.forEach((controller) => controller.updateDisplay());
    },
  };
}
