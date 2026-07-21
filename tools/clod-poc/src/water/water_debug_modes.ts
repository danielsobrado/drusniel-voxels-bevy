import type { WaterDebugBindings, WaterDebugState } from "./water_debug_types.js";
import { type WaterDebugMode, WATER_DEBUG_MODES } from "./waterConfig.js";

export const WATER_DEBUG_LABELS: Record<WaterDebugMode, string> = {
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
  suspendedScatter: "suspended scatter",
  farReflectionHit: "far reflection hit",
};

const MATERIAL_DEBUG_MODES = [
  "final",
  "depth",
  "foam",
  "fresnel",
  "bodyMask",
  "clipmapLevel",
  "flow",
  "refraction",
  "reflection",
  "ssrHit",
  "suspendedScatter",
] as const satisfies readonly WaterDebugMode[];

export const WATER_MODE_OPTIONS = Object.fromEntries(
  MATERIAL_DEBUG_MODES.map((mode) => [
    `${WATER_DEBUG_LABELS[mode]} (${WATER_DEBUG_MODES[mode]})`,
    mode,
  ]),
) as Record<string, WaterDebugMode>;

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

export function querySource(
  fallback: "hydrology" | "fake_bodies",
): "hydrology" | "fake_bodies" {
  const raw = currentSearchParams().get("waterSource");
  if (raw === "fake_bodies" || raw === "hydrology") return raw;
  return fallback;
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

export function setWaterDebugMode(
  state: WaterDebugState,
  bindings: WaterDebugBindings,
  mode: WaterDebugMode,
): void {
  state.mode = mode;
  bindings.onMode(mode);
}

function currentSearchParams(): URLSearchParams {
  return typeof window === "undefined"
    ? new URLSearchParams()
    : new URLSearchParams(window.location.search);
}
