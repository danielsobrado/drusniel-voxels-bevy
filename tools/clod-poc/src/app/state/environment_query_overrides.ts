import type { ClodAppState } from "./index.js";

function finiteParam(searchParams: URLSearchParams, ...keys: string[]): number | null {
  for (const key of keys) {
    const raw = searchParams.get(key);
    if (raw === null) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function apply(searchParams: URLSearchParams, keys: string[], setter: (value: number) => void): void {
  const value = finiteParam(searchParams, ...keys);
  if (value === null) return;
  setter(value);
}

export function applyEnvironmentQueryOverrides(state: ClodAppState, searchParams: URLSearchParams): void {
  apply(searchParams, ["sunElevationDeg", "sunElevation"], (value) => {
    state.sunElevationDeg = clamp(value, -10, 90);
  });
  apply(searchParams, ["sunAzimuthDeg", "sunAzimuth"], (value) => {
    state.sunAzimuthDeg = ((value % 360) + 360) % 360;
  });
  apply(searchParams, ["sunIntensity"], (value) => {
    state.sunIntensity = Math.max(0, value);
  });
  apply(searchParams, ["skyIntensity"], (value) => {
    state.skyIntensity = Math.max(0, value);
  });
  apply(searchParams, ["groundIntensity"], (value) => {
    state.groundIntensity = Math.max(0, value);
  });
  apply(searchParams, ["exposure"], (value) => {
    state.exposure = Math.max(0, value);
  });
  apply(searchParams, ["hazeIntensity"], (value) => {
    state.hazeIntensity = Math.max(0, value);
  });
}
