import type { BiomeVisualState } from "../environment/biome_visual_state.js";
import type { WaterBodyVisualPreset, WaterBodyVisualPresets } from "./water_body_presets.js";
import type { WaterRockFlourConfig, WaterVisualConfig } from "./water_config_types.js";

export const WATER_ROCK_FLOUR_QUERY_KEYS = ["waterRockFlour", "rockFlourWater", "glacialRockFlour"] as const;

export type WaterRockFlourState = Pick<BiomeVisualState, "enabled" | "glacialMurkiness">;

export function resolveWaterRockFlourEnabled(
  configured: boolean,
  searchParams: URLSearchParams,
): boolean {
  for (const key of WATER_ROCK_FLOUR_QUERY_KEYS) {
    const raw = searchParams.get(key);
    if (raw === null) continue;
    const normalized = raw.trim().toLowerCase();
    if (["1", "true", "on", "yes"].includes(normalized)) return true;
    if (["0", "false", "off", "no"].includes(normalized)) return false;
  }
  return configured;
}

export function effectiveWaterRockFlour(
  config: WaterRockFlourConfig,
  state: WaterRockFlourState | null,
  enabled = config.enabled,
): number {
  if (!enabled || !state?.enabled) return 0;
  return clampFraction(state.glacialMurkiness);
}

export function resolveRockFlourWaterBodyPresets(
  base: WaterBodyVisualPresets,
  config: WaterRockFlourConfig,
  state: WaterRockFlourState | null,
  enabled = config.enabled,
): WaterBodyVisualPresets {
  const amount = effectiveWaterRockFlour(config, state, enabled);
  if (amount <= 0) return base;

  const lake = resolveBodyPreset(
    base.lake,
    config.lakeColor,
    amount * nonNegative(config.lakeStrength),
    config,
  );
  const river = resolveBodyPreset(
    base.river,
    config.riverColor,
    amount * nonNegative(config.riverStrength),
    config,
  );
  if (lake === base.lake && river === base.river) return base;

  return {
    ocean: base.ocean,
    lake,
    river,
    pond: base.pond,
    marsh: base.marsh,
  };
}

export function resolveRockFlourWaterVisual(
  visual: WaterVisualConfig,
  state: WaterRockFlourState | null,
  enabled = visual.rockFlour.enabled,
): WaterVisualConfig {
  const bodies = resolveRockFlourWaterBodyPresets(visual.bodies, visual.rockFlour, state, enabled);
  return bodies === visual.bodies ? visual : { ...visual, bodies };
}

function resolveBodyPreset(
  base: WaterBodyVisualPreset,
  target: [number, number, number],
  amount: number,
  config: WaterRockFlourConfig,
): WaterBodyVisualPreset {
  const bodyAmount = clampFraction(amount);
  if (bodyAmount <= 0) return base;

  const shallowAmount = bodyAmount * clampFraction(config.shallowBlend);
  const deepAmount = bodyAmount * clampFraction(config.deepBlend);
  const safeTarget = sanitizeColor(target, base.shallowColor);
  const shallowColor = mixColor(base.shallowColor, safeTarget, shallowAmount);
  const deepColor = mixColor(base.deepColor, safeTarget, deepAmount);
  const scatterColor = mixColor(base.scatterColor, safeTarget, bodyAmount);
  const scatterExtinction = lerp(
    nonNegative(base.scatterExtinction),
    nonNegative(config.scatterExtinction),
    bodyAmount,
  );
  const scatterStrength = lerp(
    nonNegative(base.scatterStrength),
    nonNegative(config.scatterStrength),
    bodyAmount,
  );
  const scatterAmbient = lerp(
    nonNegative(base.scatterAmbient),
    nonNegative(config.scatterAmbient),
    bodyAmount,
  );

  if (
    sameColor(shallowColor, base.shallowColor)
    && sameColor(deepColor, base.deepColor)
    && sameColor(scatterColor, base.scatterColor)
    && scatterExtinction === base.scatterExtinction
    && scatterStrength === base.scatterStrength
    && scatterAmbient === base.scatterAmbient
  ) {
    return base;
  }

  return {
    ...base,
    shallowColor,
    deepColor,
    scatterColor,
    scatterExtinction,
    scatterStrength,
    scatterAmbient,
  };
}

function sanitizeColor(
  color: [number, number, number],
  fallback: [number, number, number],
): [number, number, number] {
  return [
    finiteFraction(color[0], fallback[0]),
    finiteFraction(color[1], fallback[1]),
    finiteFraction(color[2], fallback[2]),
  ];
}

function mixColor(
  start: [number, number, number],
  end: [number, number, number],
  amount: number,
): [number, number, number] {
  return [
    lerp(start[0], end[0], amount),
    lerp(start[1], end[1], amount),
    lerp(start[2], end[2], amount),
  ];
}

function sameColor(a: [number, number, number], b: [number, number, number]): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function nonNegative(value: number): number {
  return Math.max(0, finiteOr(value, 0));
}

function finiteFraction(value: number, fallback: number): number {
  return clampFraction(Number.isFinite(value) ? value : fallback);
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clampFraction(value: number): number {
  return Math.min(1, Math.max(0, finiteOr(value, 0)));
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}
