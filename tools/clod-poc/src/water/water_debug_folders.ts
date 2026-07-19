import type GUI from "lil-gui";
import { type WaterDebugMode, WATER_DEBUG_MODES } from "./waterConfig.js";
import {
  readRiverEcologySettings, reloadWithRiverEcologySettings, riverEcologyReadout,
  type RiverEcologySettings,
} from "./riverEcologyRuntime.js";
import {
  readRiverMaterialSettings, reloadWithRiverMaterialSettings,
  type RiverMaterialSettings,
} from "./riverMaterialRuntime.js";
import {
  readRiverCascadeParticleSettings, reloadWithRiverCascadeParticleSettings,
  type RiverCascadeParticleSettings,
} from "./riverCascadeParticlesRuntime.js";
import type { RiverCascadeParticleStats } from "./riverCascadeParticleOverlay.js";
import type { WaterDebugState, WaterRiverDebugStats, WaterDebugBindings } from "./water_debug_types.js";

export const WATER_DEBUG_LABELS: Record<WaterDebugMode, string> = {
  final: "final", depth: "depth", foam: "foam", fresnel: "fresnel",
  bodyMask: "body mask", clipmapLevel: "clipmap level", flow: "flow",
  hydrologyFill: "hydrology fill", accumulation: "accumulation",
  carvedBed: "carved bed", waterY: "water Y", classification: "classification",
  refraction: "refraction", reflection: "reflection", ssrHit: "SSR hit",
  suspendedScatter: "suspended scatter",
};

const MATERIAL_DEBUG_MODES = [
  "final", "depth", "foam", "fresnel", "bodyMask", "clipmapLevel",
  "flow", "refraction", "reflection", "ssrHit", "suspendedScatter",
] as const satisfies readonly WaterDebugMode[];

export const WATER_MODE_OPTIONS = Object.fromEntries(
  MATERIAL_DEBUG_MODES.map((mode) => [`${WATER_DEBUG_LABELS[mode]} (${WATER_DEBUG_MODES[mode]})`, mode]),
) as Record<string, WaterDebugMode>;

function currentSearchParams(): URLSearchParams {
  return typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
}

export function queryBool(key: string, fallback: boolean): boolean {
  const raw = currentSearchParams().get(key);
  return raw === null ? fallback : raw === "1" || raw === "true";
}

export function queryNumber(key: string, fallback: number): number {
  const raw = currentSearchParams().get(key);
  if (raw === null) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function querySource(fallback: "hydrology" | "fake_bodies"): "hydrology" | "fake_bodies" {
  const raw = currentSearchParams().get("waterSource");
  return raw === "fake_bodies" ? "fake_bodies" : raw === "hydrology" ? "hydrology" : fallback;
}

export function reloadWithRiverState(state: WaterDebugState): void {
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

export function makeEmptyRiverStats(): WaterRiverDebugStats {
  return {
    source: "unknown", hydrologyEnabled: false, riverCells: 0, lakeCells: 0, wetCells: 0, maxFlowSpeed: 0,
    fallbackRivers: false, fallbackMainRiver: false, fallbackTributaries: false,
    widenRadius: 0, carveDepthM: 0, visibleDepthM: 0, flowSpeedMultiplier: 1, fakeRiverCount: 0,
  };
}

export function makeEmptyCascadeParticleStats(): RiverCascadeParticleStats {
  return { mist: 0, splash: 0, foam: 0, lastEmitters: 0, lastCascadeEmitters: 0, lastRapidEmitters: 0, lastMaxCascade: 0, lastMaxRapid: 0 };
}

export function setWaterDebugMode(state: WaterDebugState, bindings: WaterDebugBindings, mode: WaterDebugMode): void {
  state.mode = mode;
  bindings.onMode(mode);
}

export function addRiverStatsFolder(parent: GUI, bindings: WaterDebugBindings): { refresh: () => void } {
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
  return { refresh: () => { refresh(); folder.controllers.forEach((c) => c.updateDisplay()); } };
}

export function addCascadeParticleStatsFolder(parent: GUI, bindings: WaterDebugBindings): { refresh: () => void } {
  const folder = parent.addFolder("cascade particle stats");
  const stats = makeEmptyCascadeParticleStats();
  const refresh = () => Object.assign(stats, bindings.getCascadeParticleStats?.() ?? makeEmptyCascadeParticleStats());
  refresh();
  folder.add(stats, "mist").name("mist count").disable();
  folder.add(stats, "splash").name("splash count").disable();
  folder.add(stats, "foam").name("foam drift count").disable();
  folder.add(stats, "lastEmitters").name("last emitters").disable();
  folder.add(stats, "lastCascadeEmitters").name("cascade emitters").disable();
  folder.add(stats, "lastRapidEmitters").name("rapid emitters").disable();
  folder.add(stats, "lastMaxCascade").name("max cascade").disable();
  folder.add(stats, "lastMaxRapid").name("max rapid").disable();
  folder.add({ refresh }, "refresh").name("refresh stats");
  return { refresh: () => { refresh(); folder.controllers.forEach((c) => c.updateDisplay()); } };
}

export function addRiverEcologyDebugFolder(parent: GUI, state: WaterDebugState, bindings: WaterDebugBindings): { refresh: () => void } {
  const folder = parent.addFolder("river ecology debug");
  const actions = {
    showFlow: () => setWaterDebugMode(state, bindings, "flow"),
    showFoam: () => setWaterDebugMode(state, bindings, "foam"),
    showDepth: () => setWaterDebugMode(state, bindings, "depth"),
    showFinal: () => setWaterDebugMode(state, bindings, "final"),
  };
  folder.add(actions, "showFlow").name("show flow");
  folder.add(actions, "showFoam").name("show foam");
  folder.add(actions, "showDepth").name("show depth");
  folder.add(actions, "showFinal").name("back to final");
  const readout = riverEcologyReadout();
  folder.add(readout, "grass").name("grass bands").disable();
  folder.add(readout, "understory").name("understory bands").disable();
  folder.add(readout, "trees").name("tree bands").disable();
  folder.add(readout, "stones").name("stone bands").disable();
  return { refresh: () => { Object.assign(readout, riverEcologyReadout()); folder.controllers.forEach((c) => c.updateDisplay()); } };
}

export function addRiverEcologyTuningFolder(parent: GUI): { refresh: () => void } {
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
  return { refresh: () => folder.controllers.forEach((c) => c.updateDisplay()) };
}

export function addRiverMaterialTuningFolder(parent: GUI): { refresh: () => void } {
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
  folder.add(settings, "cascadeRoughnessStrength", 0, 0.40, 0.005).name("cascade rough");
  folder.add(settings, "cascadeWhitewaterBoost", 0, 5, 0.05).name("whitewater boost");
  folder.add(settings, "wetBankStrength", 0, 2, 0.05).name("wet bank decals");
  folder.add(settings, "wetBankDistanceM", 0.5, 24, 0.5).name("wet bank distance");
  folder.add(settings, "wetRockDarkening", 0, 1, 0.02).name("wet rock darken");
  folder.add(settings, "foamResidueStrength", 0, 2, 0.05).name("foam residue");
  folder.add(settings, "foamResidueDropStart", 0, 12, 0.05).name("foam drop start");
  folder.add(settings, "foamResidueDropEnd", 0.05, 24, 0.05).name("foam drop end");
  folder.add(settings, "bankNormalStrength", 0, 3, 0.05).name("bank normal");
  folder.add(settings, "rapidScale", 0.02, 1.0, 0.01).name("rapid scale");
  folder.add(settings, "crossCurrentStrength", 0, 4, 0.05).name("cross current");
  folder.add(settings, "rapidNormalBoost", 0, 4, 0.05).name("rapid normal");
  folder.add(settings, "bankFoamStrength", 0, 3, 0.05).name("bank foam");
  folder.add(settings, "rapidFoamStrength", 0, 3, 0.05).name("rapid foam");
  folder.add(settings, "foamStreakStrength", 0, 3, 0.05).name("foam streaks");
  folder.add(settings, "shallowBankTintStrength", 0, 3, 0.05).name("shallow tint");
  folder.add(settings, "centerChannelDarkening", 0, 3, 0.05).name("center darken");
  folder.add({ apply: () => reloadWithRiverMaterialSettings(settings) }, "apply").name("apply + rebuild");
  return { refresh: () => folder.controllers.forEach((c) => c.updateDisplay()) };
}

export function addRiverCascadeParticleTuningFolder(parent: GUI): { refresh: () => void } {
  const folder = parent.addFolder("cascade mist / splash");
  const settings: RiverCascadeParticleSettings = readRiverCascadeParticleSettings();
  folder.add(settings, "enabled").name("enabled");
  folder.add(settings, "mistStrength", 0, 3, 0.05).name("mist strength");
  folder.add(settings, "splashStrength", 0, 3, 0.05).name("splash strength");
  folder.add(settings, "foamDriftStrength", 0, 3, 0.05).name("foam drift");
  folder.add(settings, "spawnRadiusM", 16, 180, 1).name("spawn radius");
  folder.add(settings, "maxEmittersPerTick", 4, 80, 1).name("max emitters");
  folder.add(settings, "rapidSpeedStart", 0.05, 8, 0.05).name("rapid start");
  folder.add(settings, "rapidSpeedEnd", 0.10, 12, 0.05).name("rapid end");
  folder.add(settings, "dropStart", 0, 12, 0.05).name("drop start");
  folder.add(settings, "dropEnd", 0.05, 24, 0.05).name("drop end");
  folder.add({ apply: () => reloadWithRiverCascadeParticleSettings(settings) }, "apply").name("apply + rebuild");
  return { refresh: () => folder.controllers.forEach((c) => c.updateDisplay()) };
}
