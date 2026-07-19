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

export function addRiverStatsFolder(root: GUI, bindings: WaterDebugBindings): { refresh(): void } {
  const folder = root.addFolder("river stats");
  const stats = makeEmptyRiverStats();
  for (const key of Object.keys(stats) as Array<keyof WaterRiverDebugStats>) folder.add(stats, key).listen();
  return {
    refresh: () => Object.assign(stats, bindings.getRiverStats()),
  };
}

export function addCascadeParticleStatsFolder(root: GUI, bindings: WaterDebugBindings): { refresh(): void } {
  const folder = root.addFolder("cascade particles");
  const stats = makeEmptyCascadeParticleStats();
  for (const key of Object.keys(stats) as Array<keyof RiverCascadeParticleStats>) folder.add(stats, key).listen();
  return {
    refresh: () => Object.assign(stats, bindings.getRiverCascadeParticleStats()),
  };
}

export function addRiverEcologyDebugFolder(root: GUI, state: WaterDebugState, bindings: WaterDebugBindings): { refresh(): void } {
  const folder = root.addFolder("river ecology debug");
  const debug = {
    mode: "off",
    enabled: true,
    sampleAtPlayer: () => bindings.sampleRiverEcologyAtPlayer(),
  };
  folder.add(debug, "enabled").name("enabled").onChange((enabled: boolean) => bindings.onRiverEcologyEnabled(enabled));
  folder.add(debug, "mode", ["off", "bank", "riverbed", "rapids", "moisture", "species"]).name("overlay").onChange((mode: string) => bindings.onRiverEcologyMode(mode));
  folder.add(debug, "sampleAtPlayer").name("sample at player");
  return { refresh: () => folder.controllers.forEach((controller) => controller.updateDisplay()) };
}

export function addRiverEcologyTuningFolder(root: GUI): { refresh(): void } {
  const folder = root.addFolder("river ecology tuning");
  const settings: RiverEcologySettings = { ...readRiverEcologySettings() };
  const keys = Object.keys(settings) as Array<keyof RiverEcologySettings>;
  for (const key of keys) {
    const value = settings[key];
    if (typeof value === "boolean") folder.add(settings, key).name(String(key));
    else if (typeof value === "number") folder.add(settings, key).name(String(key));
  }
  folder.add({ apply: () => reloadWithRiverEcologySettings(settings) }, "apply").name("apply + reload");
  return { refresh: () => Object.assign(settings, readRiverEcologySettings()) };
}

export function addRiverMaterialTuningFolder(root: GUI): { refresh(): void } {
  const folder = root.addFolder("river material tuning");
  const settings: RiverMaterialSettings = { ...readRiverMaterialSettings() };
  const keys = Object.keys(settings) as Array<keyof RiverMaterialSettings>;
  for (const key of keys) {
    const value = settings[key];
    if (typeof value === "boolean") folder.add(settings, key).name(String(key));
    else if (typeof value === "number") folder.add(settings, key).name(String(key));
  }
  folder.add({ apply: () => reloadWithRiverMaterialSettings(settings) }, "apply").name("apply + reload");
  return { refresh: () => Object.assign(settings, readRiverMaterialSettings()) };
}

export function addRiverCascadeParticleTuningFolder(root: GUI): { refresh(): void } {
  const folder = root.addFolder("river cascade particle tuning");
  const settings: RiverCascadeParticleSettings = { ...readRiverCascadeParticleSettings() };
  const keys = Object.keys(settings) as Array<keyof RiverCascadeParticleSettings>;
  for (const key of keys) {
    const value = settings[key];
    if (typeof value === "boolean") folder.add(settings, key).name(String(key));
    else if (typeof value === "number") folder.add(settings, key).name(String(key));
  }
  folder.add({ apply: () => reloadWithRiverCascadeParticleSettings(settings) }, "apply").name("apply + reload");
  return { refresh: () => Object.assign(settings, readRiverCascadeParticleSettings()) };
}

export function addRiverEcologyReadoutFolder(root: GUI): { refresh(): void } {
  const folder = root.addFolder("river ecology readout");
  const readout = riverEcologyReadout();
  for (const key of Object.keys(readout)) folder.add(readout, key as never).listen();
  return { refresh: () => Object.assign(readout, riverEcologyReadout()) };
}
