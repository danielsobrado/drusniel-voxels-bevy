// Per-body-kind water visual presets (Phase 7b).
//
// Every water material colours a fragment from the preset of its HYDROLOGY_BODY_* kind:
// shallow/deep colour, RGB Beer–Lambert absorption (per metre, replacing the scalar
// depth-scale), turbidity, and a reflection damping factor (murky standing water
// reflects less sky). Presets live in config (`water.visual.bodies`); the derived
// defaults keep lakes/rivers/ocean exactly on the pre-7b look (neutral absorption
// 1/depthScale) and encode the pond/marsh murk that used to be in-shader constants in
// waterPerfNodeMaterial.
//
// Uniform layout: arrays indexed directly by body kind (0 dry … 5 marsh; the dry slot
// mirrors lake so interpolated kind values never read garbage).
import {
  HYDROLOGY_BODY_DRY,
  HYDROLOGY_BODY_LAKE,
  HYDROLOGY_BODY_MARSH,
  HYDROLOGY_BODY_OCEAN,
  HYDROLOGY_BODY_POND,
  HYDROLOGY_BODY_RIVER,
} from "./hydrologyGrid.js";

export const WATER_BODY_KIND_COUNT = 6;

export interface WaterBodyVisualPreset {
  shallowColor: [number, number, number];
  deepColor: [number, number, number];
  /** Beer–Lambert extinction per metre, per RGB channel. */
  absorption: [number, number, number];
  turbidity: number;
  /** 1 = full sky reflection, lower = damped (sediment-laden standing water). */
  reflectionDamping: number;
}

export interface WaterBodyVisualPresets {
  ocean: WaterBodyVisualPreset;
  lake: WaterBodyVisualPreset;
  river: WaterBodyVisualPreset;
  pond: WaterBodyVisualPreset;
  marsh: WaterBodyVisualPreset;
}

export interface WaterBodyPresetBase {
  shallowColor: [number, number, number];
  deepColor: [number, number, number];
  depthScale: number;
  turbidity: number;
}

function mixColor(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * Defaults derived from the base visual scalars so an unconfigured `bodies:` section
 * changes nothing: lake/river/ocean use neutral absorption `1/depthScale` (identical to
 * the old scalar response); pond/marsh reproduce the former in-shader murk constants.
 */
export function deriveDefaultWaterBodyPresets(base: WaterBodyPresetBase): WaterBodyVisualPresets {
  const k = 1 / Math.max(0.05, base.depthScale);
  const clear: WaterBodyVisualPreset = {
    shallowColor: [...base.shallowColor],
    deepColor: [...base.deepColor],
    absorption: [k, k, k],
    turbidity: base.turbidity,
    reflectionDamping: 1,
  };
  const pond: WaterBodyVisualPreset = {
    shallowColor: mixColor(base.shallowColor, [0.06, 0.16, 0.10], 0.38),
    deepColor: mixColor(base.deepColor, [0.05, 0.13, 0.08], 0.38),
    absorption: [k * 2.2, k * 1.5, k * 1.9],
    turbidity: base.turbidity + 0.25,
    reflectionDamping: 0.55,
  };
  const marsh: WaterBodyVisualPreset = {
    shallowColor: mixColor(base.shallowColor, [0.10, 0.14, 0.06], 0.50),
    deepColor: mixColor(base.deepColor, [0.08, 0.11, 0.05], 0.50),
    absorption: [k * 2.6, k * 1.8, k * 2.3],
    turbidity: base.turbidity + 0.35,
    reflectionDamping: 0.45,
  };
  return {
    ocean: { ...clear, shallowColor: [...clear.shallowColor], deepColor: [...clear.deepColor], absorption: [...clear.absorption] },
    lake: clear,
    river: {
      ...clear,
      shallowColor: [...clear.shallowColor],
      deepColor: [...clear.deepColor],
      absorption: [...clear.absorption],
    },
    pond,
    marsh,
  };
}

/** Presets indexed by HYDROLOGY_BODY_* kind (dry slot mirrors lake so interpolated
 *  kind values never read garbage). Single source for every uniform-array packer. */
export function waterBodyPresetsByKind(presets: WaterBodyVisualPresets): WaterBodyVisualPreset[] {
  const byKind: WaterBodyVisualPreset[] = [];
  byKind[HYDROLOGY_BODY_DRY] = presets.lake;
  byKind[HYDROLOGY_BODY_OCEAN] = presets.ocean;
  byKind[HYDROLOGY_BODY_LAKE] = presets.lake;
  byKind[HYDROLOGY_BODY_RIVER] = presets.river;
  byKind[HYDROLOGY_BODY_POND] = presets.pond;
  byKind[HYDROLOGY_BODY_MARSH] = presets.marsh;
  return byKind;
}
