// Stone-overlay configuration. Mirrors the shape of the future Rust `assets/config/stones.yaml`
// so placement stays config-driven (no hardcoded class distances / sink factors) and the two
// implementations can be diffed. Slope here is expressed as terrain normal.y (1 = flat,
// lower = steeper), matching the PoC terrain API and the grass system.

import type { RockPreset } from "./rock_builder.js";

export type StoneClass = "large" | "medium" | "small";

export const STONE_CLASSES: readonly StoneClass[] = ["large", "medium", "small"] as const;

export interface StoneClassConfig {
  /** target world radius range (m); per-instance scale hits a value in this band */
  radiusMin: number;
  radiusMax: number;
  /** visible out to this many metres */
  maxDistance: number;
  /** base fraction of radius sunk into the ground on flat terrain */
  sink: number;
  /** icosphere subdivision levels, near → far (drives mesh LOD pool) */
  lodDetails: number[];
  /** distinct meshes generated per class */
  variants: number;
  /** preset pool this class draws from (context biases the choice in scatter) */
  presets: RockPreset[];
  /** parity flag with the Rust shadow LOD policy; the PoC does not cull shadows */
  shadows: boolean;
}

export interface StoneSettings {
  enabled: boolean;
  seed: number;
  /** scatter grid spacing (m) */
  cellSize: number;
  /** hard cap on rendered instances */
  maxInstances: number;
  /** global density multiplier (0 disables, 1 = nominal) */
  density: number;
  /** normal.y at/above which slope imposes no penalty */
  slopeReposeStart: number;
  /** normal.y below which the site is fully rejected (too steep, stones can't rest) */
  slopeRepose: number;
  /** reject candidates below WATER_LEVEL + this margin (m) */
  waterMargin: number;
  /** extra large-stone weight in streambeds */
  streamLargeBias: number;
  /** uphill cliff probe distances (m) */
  cliffProbeNear: number;
  cliffProbeFar: number;
  /** bed = slope * sinkSlopeMultiplier + 1, deepening sink on slopes */
  sinkSlopeMultiplier: number;
  /** max lean (rad) toward the terrain normal */
  normalLean: number;
  classes: Record<StoneClass, StoneClassConfig>;
}

export const DEFAULT_STONE_SETTINGS: StoneSettings = {
  enabled: false,
  seed: 931777,
  cellSize: 2.1,
  maxInstances: 120000,
  density: 1.0,
  slopeReposeStart: 0.78,
  slopeRepose: 0.5,
  waterMargin: 0.5,
  streamLargeBias: 0.16,
  cliffProbeNear: 8.0,
  cliffProbeFar: 18.0,
  sinkSlopeMultiplier: 0.9,
  normalLean: 0.4,
  classes: {
    large: {
      radiusMin: 0.6,
      radiusMax: 2.2,
      maxDistance: 900,
      sink: 0.3,
      lodDetails: [3, 2],
      variants: 4,
      presets: ["talus", "boulder"],
      shadows: true,
    },
    medium: {
      radiusMin: 0.2,
      radiusMax: 0.6,
      maxDistance: 280,
      sink: 0.26,
      lodDetails: [2, 1],
      variants: 4,
      presets: ["cobble", "talus"],
      shadows: false,
    },
    small: {
      radiusMin: 0.06,
      radiusMax: 0.2,
      maxDistance: 90,
      sink: 0.22,
      lodDetails: [1],
      variants: 4,
      presets: ["cobble"],
      shadows: false,
    },
  },
};

/** Base class-selection weights before context bias (small most common). */
export const CLASS_BASE_WEIGHTS: Record<StoneClass, number> = {
  large: 0.1,
  medium: 0.32,
  small: 0.58,
};
