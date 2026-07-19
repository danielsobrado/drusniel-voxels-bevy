import { clamp, max, mix, uniform } from "three/tsl";
import { DEFAULT_GRASS_APPEARANCE_SETTINGS } from "../grass/grass_config_defaults.js";
import {
  GRASS_DRY_LINEAR,
  GRASS_SHARED_BASE_LINEAR,
  GRASS_TIP_LINEAR,
  linearRgbToHex,
} from "../grass/grass_palette.js";
import { setStoneStyle, STONE_STYLE_NAMES, type StoneStyleName } from "../stones/stone_style.js";

/**
 * Scene-wide style presets: one selectable look applied homogeneously across
 * stones, grass, trees, understory, and water. Each system keeps its own
 * knowledge of *how* to look stylized; this module only carries the preset
 * table, the shared vegetation wrap uniform, and the applier registry that
 * fans `setSceneStyle` out to systems that own their uniforms elsewhere
 * (water registers itself when its uniforms are created).
 */
export const SCENE_STYLE_NAMES = STONE_STYLE_NAMES;
export type SceneStyleName = StoneStyleName;

export interface SceneStyleGrassPreset {
  readonly baseColor: string;
  readonly tipColor: string;
  readonly dryColor: string;
  readonly patchStrength: number;
}

export interface SceneStyleWaterPreset {
  /** Multiplier on the configured shoreline foam strength. */
  readonly foamShoreMul: number;
  /** 0..1 pull of the fresnel normal flatten toward fully flat (graphic water). */
  readonly normalFlattenPull: number;
  readonly glitter: boolean;
}

export interface SceneStylePreset {
  /** 0 = hard n·l sun term, 1 = half-Lambert wrap; trees + understory foliage. */
  readonly vegetationWrap: number;
  readonly grass: SceneStyleGrassPreset;
  readonly water: SceneStyleWaterPreset;
}

const REALISTIC_GRASS: SceneStyleGrassPreset = {
  baseColor: linearRgbToHex(GRASS_SHARED_BASE_LINEAR),
  tipColor: linearRgbToHex(GRASS_TIP_LINEAR),
  dryColor: linearRgbToHex(GRASS_DRY_LINEAR),
  patchStrength: DEFAULT_GRASS_APPEARANCE_SETTINGS.patchStrength,
};

export const SCENE_STYLE_PRESETS: Record<SceneStyleName, SceneStylePreset> = {
  realistic: {
    vegetationWrap: 0,
    grass: REALISTIC_GRASS,
    water: { foamShoreMul: 1, normalFlattenPull: 0, glitter: true },
  },
  stylized: {
    vegetationWrap: 0.55,
    grass: { baseColor: "#7fae53", tipColor: "#a9c96a", dryColor: "#a5915c", patchStrength: 0.35 },
    water: { foamShoreMul: 1.3, normalFlattenPull: 0.4, glitter: true },
  },
  toon: {
    vegetationWrap: 0.85,
    grass: { baseColor: "#6cb03d", tipColor: "#93d64f", dryColor: "#b3a05a", patchStrength: 0.12 },
    water: { foamShoreMul: 1.6, normalFlattenPull: 0.7, glitter: false },
  },
};

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

let currentStyle: SceneStyleName = "realistic";
const uVegetationWrap = uniform(SCENE_STYLE_PRESETS.realistic.vegetationWrap);

export type SceneStyleApplier = (preset: SceneStylePreset, name: SceneStyleName) => void;
const appliers = new Set<SceneStyleApplier>();

export function readSceneStyle(): SceneStylePreset & { name: SceneStyleName } {
  return { name: currentStyle, ...SCENE_STYLE_PRESETS[currentStyle] };
}

/**
 * Registers a per-system applier and immediately applies the current style so
 * late-created systems (water materials, rebuilt scenes) come up styled.
 * Returns an unregister function.
 */
export function registerSceneStyleApplier(applier: SceneStyleApplier): () => void {
  appliers.add(applier);
  applier(SCENE_STYLE_PRESETS[currentStyle], currentStyle);
  return () => appliers.delete(applier);
}

export function setSceneStyle(name: SceneStyleName): void {
  currentStyle = name in SCENE_STYLE_PRESETS ? name : "realistic";
  const preset = SCENE_STYLE_PRESETS[currentStyle];
  uVegetationWrap.value = preset.vegetationWrap;
  setStoneStyle(currentStyle);
  for (const applier of appliers) applier(preset, currentStyle);
}

/** Shared sun-term wrap for tree/understory node materials (live uniform). */
export function styleWrappedSunTerm(nl: TslNode): TslNode {
  return mix(max(nl, 0.0), clamp(nl.mul(0.5).add(0.5), 0.0, 1.0), uVegetationWrap);
}
