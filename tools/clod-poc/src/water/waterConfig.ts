// Config contract for the fake water clipmap (config/water.yaml).
//
// Water is a POC visual layer only. It never feeds the CLOD page source mesh,
// meshoptimizer simplification, page borders, LOD selection, colliders, or
// validation. The dependency direction is scene -> water, never pages -> water.
import { load } from "js-yaml";

/** Debug render modes for the water material. */
export const WATER_DEBUG_MODES = {
  final: 0,
  depth: 1,
  foam: 2,
  fresnel: 3,
  bodyMask: 4,
  clipmapLevel: 5,
} as const;
export type WaterDebugMode = keyof typeof WATER_DEBUG_MODES;
export type WaterDebugModeId = typeof WATER_DEBUG_MODES[WaterDebugMode];

export interface LakeBodyConfig {
  center: [number, number];
  radius: [number, number];
  levelOffset: number;
}

export interface RiverBodyConfig {
  points: Array<[number, number]>;
  width: number;
  levelOffset: number;
  downstreamDrop: number;
}

export interface WaterVisualConfig {
  shallowColor: [number, number, number];
  deepColor: [number, number, number];
  foamColor: [number, number, number];
  alpha: number;
  fresnelPower: number;
  rippleAmp: number;
  rippleSpeed: number;
  shoreFoamStart: number;
  shoreFoamEnd: number;
  maxDepthForColor: number;
  depthWrite: boolean;
}

export interface WaterDebugConfig {
  mode: WaterDebugModeId;
}

export interface WaterConfig {
  enabled: boolean;
  cellsPerLevel: number;
  cellSizes: number[];
  snapCells: number;
  drySentinelDepth: number;
  fakeBodies: {
    lakes: LakeBodyConfig[];
    rivers: RiverBodyConfig[];
  };
  visual: WaterVisualConfig;
  debug: WaterDebugConfig;
}

export const DEFAULT_WATER_VISUAL: WaterVisualConfig = {
  shallowColor: [0.16, 0.38, 0.36],
  deepColor: [0.02, 0.08, 0.12],
  foamColor: [0.82, 0.88, 0.84],
  alpha: 0.82,
  fresnelPower: 5.0,
  rippleAmp: 1.0,
  rippleSpeed: 0.45,
  shoreFoamStart: 0.03,
  shoreFoamEnd: 0.16,
  maxDepthForColor: 4.0,
  depthWrite: false,
};

export const DEFAULT_WATER_CONFIG: WaterConfig = {
  enabled: true,
  cellsPerLevel: 128,
  cellSizes: [1.5, 3.0, 6.0, 12.0, 24.0],
  snapCells: 2,
  drySentinelDepth: 2.0,
  fakeBodies: {
    lakes: [
      { center: [80, -70], radius: [85, 55], levelOffset: 1.2 },
      { center: [-180, 120], radius: [60, 45], levelOffset: 0.8 },
    ],
    rivers: [
      {
        points: [[-260, -180], [-140, -90], [-20, -40], [90, -20], [230, 70]],
        width: 18.0,
        levelOffset: 0.9,
        downstreamDrop: 3.5,
      },
    ],
  },
  visual: { ...DEFAULT_WATER_VISUAL },
  debug: { mode: WATER_DEBUG_MODES.final },
};

export function cloneWaterConfig(config: WaterConfig = DEFAULT_WATER_CONFIG): WaterConfig {
  return {
    ...config,
    cellSizes: [...config.cellSizes],
    fakeBodies: {
      lakes: config.fakeBodies.lakes.map((lake) => ({
        center: [...lake.center] as [number, number],
        radius: [...lake.radius] as [number, number],
        levelOffset: lake.levelOffset,
      })),
      rivers: config.fakeBodies.rivers.map((river) => ({
        points: river.points.map((p) => [...p] as [number, number]),
        width: river.width,
        levelOffset: river.levelOffset,
        downstreamDrop: river.downstreamDrop,
      })),
    },
    visual: {
      ...config.visual,
      shallowColor: [...config.visual.shallowColor] as [number, number, number],
      deepColor: [...config.visual.deepColor] as [number, number, number],
      foamColor: [...config.visual.foamColor] as [number, number, number],
    },
    debug: { ...config.debug },
  };
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readNumberAtLeast(value: unknown, fallback: number, min: number): number {
  return Math.max(min, readNumber(value, fallback));
}

function readIntegerAtLeast(value: unknown, fallback: number, min: number): number {
  return Math.max(min, Math.floor(readNumber(value, fallback)));
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readVec2(value: unknown, fallback: [number, number]): [number, number] {
  if (!Array.isArray(value) || value.length < 2) return [...fallback];
  const a = readNumber(value[0], Number.NaN);
  const b = readNumber(value[1], Number.NaN);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return [...fallback];
  return [a, b];
}

function readVec3(value: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(value) || value.length < 3) return [...fallback];
  const a = readNumber(value[0], Number.NaN);
  const b = readNumber(value[1], Number.NaN);
  const c = readNumber(value[2], Number.NaN);
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) return [...fallback];
  return [a, b, c];
}

function readNumberArray(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value) || value.length === 0) return [...fallback];
  const out: number[] = [];
  for (const entry of value) {
    const n = readNumber(entry, Number.NaN);
    if (!Number.isFinite(n) || n <= 0) continue;
    out.push(n);
  }
  return out.length > 0 ? out : [...fallback];
}

function readPointArray(value: unknown, fallback: Array<[number, number]>): Array<[number, number]> {
  if (!Array.isArray(value) || value.length < 2) return fallback.map((p) => [...p] as [number, number]);
  const out: Array<[number, number]> = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const a = readNumber(entry[0], Number.NaN);
    const b = readNumber(entry[1], Number.NaN);
    if (Number.isFinite(a) && Number.isFinite(b)) out.push([a, b]);
  }
  return out.length >= 2 ? out : fallback.map((p) => [...p] as [number, number]);
}

function warnWater(message: string, warn?: (message: string) => void): void {
  warn?.(`[water-config] ${message}`);
}

interface WaterYamlConfig {
  water?: {
    enabled?: unknown;
    cells_per_level?: unknown;
    cell_sizes?: unknown;
    snap_cells?: unknown;
    dry_sentinel_depth?: unknown;
    fake_bodies?: {
      lakes?: Array<{
        center?: unknown;
        radius?: unknown;
        level_offset?: unknown;
      }>;
      rivers?: Array<{
        points?: unknown;
        width?: unknown;
        level_offset?: unknown;
        downstream_drop?: unknown;
      }>;
    };
    visual?: {
      shallow_color?: unknown;
      deep_color?: unknown;
      foam_color?: unknown;
      alpha?: unknown;
      fresnel_power?: unknown;
      ripple_amp?: unknown;
      ripple_speed?: unknown;
      shore_foam_start?: unknown;
      shore_foam_end?: unknown;
      max_depth_for_color?: unknown;
      depth_write?: unknown;
    };
    debug?: { mode?: unknown };
  };
}

function isWaterDebugModeId(value: unknown): value is WaterDebugModeId {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 5;
}

export function parseWaterConfig(
  text: string | null | undefined,
  warn: ((message: string) => void) | null = console.warn,
): WaterConfig {
  const fallback = cloneWaterConfig();
  if (!text || text.trim() === "") return fallback;

  let rawConfig: WaterYamlConfig;
  try {
    rawConfig = (load(text) ?? {}) as WaterYamlConfig;
  } catch (error) {
    warnWater(
      `failed to parse config/water.yaml; using defaults: ${error instanceof Error ? error.message : String(error)}`,
      warn ?? undefined,
    );
    return fallback;
  }

  const raw = rawConfig.water ?? {};
  const fb = DEFAULT_WATER_CONFIG;

  const rawLakes = raw.fake_bodies?.lakes;
  const lakes: LakeBodyConfig[] = [];
  for (const rawLake of rawLakes ?? []) {
    lakes.push({
      center: readVec2(rawLake.center, fb.fakeBodies.lakes[0].center),
      radius: readVec2(rawLake.radius, fb.fakeBodies.lakes[0].radius),
      levelOffset: readNumber(rawLake.level_offset, fb.fakeBodies.lakes[0].levelOffset),
    });
  }
  if (lakes.length === 0 && (rawLakes ?? []).length > 0) {
    warnWater("all lake entries invalid; using default lakes", warn ?? undefined);
  }
  // Explicit empty array means "no lakes"; missing key or all-invalid falls back to defaults.
  const fallbackLakes = lakes.length > 0 ? lakes
    : (rawLakes !== undefined && rawLakes.length === 0) ? []
    : fb.fakeBodies.lakes;

  const rawRivers = raw.fake_bodies?.rivers;
  const rivers: RiverBodyConfig[] = [];
  for (const rawRiver of rawRivers ?? []) {
    const points = readPointArray(rawRiver.points, fb.fakeBodies.rivers[0].points);
    rivers.push({
      points,
      width: readNumberAtLeast(rawRiver.width, fb.fakeBodies.rivers[0].width, 0.1),
      levelOffset: readNumber(rawRiver.level_offset, fb.fakeBodies.rivers[0].levelOffset),
      downstreamDrop: readNumber(rawRiver.downstream_drop, fb.fakeBodies.rivers[0].downstreamDrop),
    });
  }
  if (rivers.length === 0 && (rawRivers ?? []).length > 0) {
    warnWater("all river entries invalid; using default rivers", warn ?? undefined);
  }
  const fallbackRivers = rivers.length > 0 ? rivers
    : (rawRivers !== undefined && rawRivers.length === 0) ? []
    : fb.fakeBodies.rivers;

  const v = raw.visual ?? {};
  const visual: WaterVisualConfig = {
    shallowColor: readVec3(v.shallow_color, fb.visual.shallowColor),
    deepColor: readVec3(v.deep_color, fb.visual.deepColor),
    foamColor: readVec3(v.foam_color, fb.visual.foamColor),
    alpha: Math.min(1, Math.max(0, readNumber(v.alpha, fb.visual.alpha))),
    fresnelPower: readNumberAtLeast(v.fresnel_power, fb.visual.fresnelPower, 0.1),
    rippleAmp: readNumberAtLeast(v.ripple_amp, fb.visual.rippleAmp, 0),
    rippleSpeed: readNumberAtLeast(v.ripple_speed, fb.visual.rippleSpeed, 0),
    shoreFoamStart: readNumber(v.shore_foam_start, fb.visual.shoreFoamStart),
    shoreFoamEnd: readNumber(v.shore_foam_end, fb.visual.shoreFoamEnd),
    maxDepthForColor: readNumberAtLeast(v.max_depth_for_color, fb.visual.maxDepthForColor, 0.1),
    depthWrite: readBoolean(v.depth_write, fb.visual.depthWrite),
  };
  if (visual.shoreFoamEnd < visual.shoreFoamStart) {
    visual.shoreFoamEnd = visual.shoreFoamStart;
  }

  const debugModeRaw = raw.debug?.mode;
  const debugMode: WaterDebugModeId = isWaterDebugModeId(debugModeRaw)
    ? debugModeRaw
    : fb.debug.mode;

  const cellSizes = readNumberArray(raw.cell_sizes, fb.cellSizes);
  const cellsPerLevel = readIntegerAtLeast(raw.cells_per_level, fb.cellsPerLevel, 4);
  const snapCells = readIntegerAtLeast(raw.snap_cells, fb.snapCells, 1);
  const drySentinelDepth = readNumberAtLeast(raw.dry_sentinel_depth, fb.drySentinelDepth, 0.1);

  return {
    enabled: readBoolean(raw.enabled, fb.enabled),
    cellsPerLevel,
    cellSizes,
    snapCells,
    drySentinelDepth,
    fakeBodies: { lakes: fallbackLakes, rivers: fallbackRivers },
    visual,
    debug: { mode: debugMode },
  };
}
