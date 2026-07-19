import { uniform } from "three/tsl";

/**
 * S1 stone style presets: one selectable look for stone shading + silhouette.
 * Shading knobs are live uniforms (instant); `geometrySoften` scales the
 * rock displacement field and needs a stone rebuild to take effect.
 */
export const STONE_STYLE_NAMES = ["realistic", "stylized", "toon"] as const;
export type StoneStyleName = typeof STONE_STYLE_NAMES[number];

export interface StoneStylePreset {
  /** 0 = hard n·l sun term, 1 = full half-Lambert wrap ramp. */
  readonly wrap: number;
  /** Procedural grain amplitude relative to the realistic look (1 = unchanged). */
  readonly grain: number;
  /** 0..1 pull of the albedo back toward clean strata bands (drops hue jitter/grain color). */
  readonly flatten: number;
  /** 0..1 softening of macro/ridged/micro displacement + extra facet rounding (rebuild). */
  readonly geometrySoften: number;
}

export const STONE_STYLE_PRESETS: Record<StoneStyleName, StoneStylePreset> = {
  realistic: { wrap: 0, grain: 1, flatten: 0, geometrySoften: 0 },
  stylized: { wrap: 0.55, grain: 0.35, flatten: 0.45, geometrySoften: 0.55 },
  toon: { wrap: 0.85, grain: 0.1, flatten: 0.75, geometrySoften: 0.8 },
};

let currentStyle: StoneStyleName = "realistic";

const uWrap = uniform(STONE_STYLE_PRESETS.realistic.wrap);
const uGrain = uniform(STONE_STYLE_PRESETS.realistic.grain);
const uFlatten = uniform(STONE_STYLE_PRESETS.realistic.flatten);

export function setStoneStyle(name: StoneStyleName): void {
  const preset = STONE_STYLE_PRESETS[name] ?? STONE_STYLE_PRESETS.realistic;
  currentStyle = name in STONE_STYLE_PRESETS ? name : "realistic";
  uWrap.value = preset.wrap;
  uGrain.value = preset.grain;
  uFlatten.value = preset.flatten;
}

export function readStoneStyle(): StoneStylePreset & { name: StoneStyleName } {
  return { name: currentStyle, ...STONE_STYLE_PRESETS[currentStyle] };
}

/** Live shading uniforms shared by every stone material instance. */
export function stoneStyleUniforms(): { wrap: unknown; grain: unknown; flatten: unknown } {
  return { wrap: uWrap, grain: uGrain, flatten: uFlatten };
}

export interface SoftenableRockParams {
  macro: number;
  strata: number;
  ridged: number;
  micro: number;
  cutBite: number;
}

/** Facet rounding used when clamping the radius against fracture planes. */
export function rockFacetRounding(soften: number): number {
  return 0.035 + 0.12 * Math.max(0, Math.min(1, soften));
}

export function softenRockParams<T extends SoftenableRockParams>(params: T, soften: number): T {
  const s = Math.max(0, Math.min(1, soften));
  if (s === 0) return params;
  return {
    ...params,
    macro: params.macro * (1 - 0.5 * s),
    strata: params.strata * (1 - 0.35 * s),
    ridged: params.ridged * (1 - 0.7 * s),
    micro: params.micro * (1 - 0.8 * s),
    cutBite: params.cutBite * (1 - 0.3 * s),
  };
}
