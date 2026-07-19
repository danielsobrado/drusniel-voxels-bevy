import {
  DEFAULT_HYDROLOGY_CONFIG,
  type HydrologyGravelBarsConfig,
  type HydrologyGravelBedConfig,
} from "./hydrologyConfig.js";

const GRAVEL_BAR_QUERY_KEYS = [
  "gravelBars",
  "riverGravelBars",
  "stoneGravelBars",
] as const;

let settings = cloneGravelBarSettings(DEFAULT_HYDROLOGY_CONFIG.gravelBars);
let bedSettings = cloneGravelBedSettings(DEFAULT_HYDROLOGY_CONFIG.gravelBed);
let stonesEnabledOverride: boolean | null = null;

export function setGravelBarSettings(next: HydrologyGravelBarsConfig): void {
  settings = cloneGravelBarSettings(next);
}

export function readGravelBarSettings(): HydrologyGravelBarsConfig {
  return settings;
}

export function setGravelBedSettings(next: HydrologyGravelBedConfig): void {
  bedSettings = cloneGravelBedSettings(next);
}

export function readGravelBedSettings(): HydrologyGravelBedConfig {
  return bedSettings;
}

export function setGravelBarStonesEnabled(enabled: boolean): void {
  stonesEnabledOverride = Boolean(enabled);
}

export function resetGravelBarRuntimeOverrides(): void {
  stonesEnabledOverride = null;
}

export function gravelBarStonesEnabled(search = currentSearch()): boolean {
  if (!settings.enabled || settings.strength <= 0) return false;
  return stonesEnabledOverride ?? queryOverride(search) ?? settings.stonesEnabled;
}

function cloneGravelBarSettings(config: HydrologyGravelBarsConfig): HydrologyGravelBarsConfig {
  return { ...config };
}

function cloneGravelBedSettings(config: HydrologyGravelBedConfig): HydrologyGravelBedConfig {
  return { ...config };
}

function currentSearch(): string {
  const location = (globalThis as typeof globalThis & { location?: { search?: string } }).location;
  return typeof location?.search === "string" ? location.search : "";
}

function queryOverride(search: string): boolean | null {
  const params = new URLSearchParams(search);
  for (const key of GRAVEL_BAR_QUERY_KEYS) {
    if (!params.has(key)) continue;
    return parseFlag(params.get(key));
  }
  return null;
}

function parseFlag(value: string | null): boolean {
  if (value === null || value === "") return true;
  const normalized = value.trim().toLowerCase();
  return normalized !== "0" && normalized !== "false" && normalized !== "off" && normalized !== "no";
}
