import { readEnvironmentalMaskSettings } from "../environment_masks/environment_mask_runtime.js";

export const RIVER_COBBLE_QUERY_KEYS = [
  "riverCobbles",
  "underwaterCobbles",
  "stoneRiverCobbles",
] as const;

const RIVER_COBBLE_CANONICAL_QUERY_KEY = RIVER_COBBLE_QUERY_KEYS[0];

let runtimeOverride: boolean | null = null;

export function riverCobbleGpuAvailable(): boolean {
  const settings = readEnvironmentalMaskSettings();
  return settings.enabled && settings.riverCobble.enabled;
}

export function riverCobbleGpuEnabled(search = currentSearch()): boolean {
  if (!riverCobbleGpuAvailable()) return false;
  if (runtimeOverride !== null) return runtimeOverride;
  return riverCobbleQueryEnabled(search);
}

export function riverCobbleQueryEnabled(search: string | URLSearchParams): boolean {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  for (const key of RIVER_COBBLE_QUERY_KEYS) {
    if (!params.has(key)) continue;
    return parseFlag(params.get(key));
  }
  return false;
}

export function setRiverCobbleGpuEnabled(enabled: boolean | null): void {
  runtimeOverride = enabled;
}

export function syncRiverCobbleQuery(enabled: boolean): void {
  const location = currentLocation();
  const history = currentHistory();
  if (!location || !history) return;

  const url = new URL(location.href);
  for (const key of RIVER_COBBLE_QUERY_KEYS) url.searchParams.delete(key);
  url.searchParams.set(RIVER_COBBLE_CANONICAL_QUERY_KEY, enabled ? "1" : "0");
  history.replaceState(history.state, "", url.toString());
}

function currentSearch(): string {
  return currentLocation()?.search ?? "";
}

function currentLocation(): Location | null {
  const location = (globalThis as typeof globalThis & { location?: Location }).location;
  return location ?? null;
}

function currentHistory(): History | null {
  const history = (globalThis as typeof globalThis & { history?: History }).history;
  return history ?? null;
}

function parseFlag(value: string | null): boolean {
  if (value === null || value === "") return true;
  const normalized = value.trim().toLowerCase();
  return normalized !== "0" && normalized !== "false" && normalized !== "off" && normalized !== "no";
}
