import type { TreeSettings, TreeSpeciesId, TreeSpeciesSettings } from "./tree_config.js";

export const TREE_CROWN_PROXY_MIN_DENSITY = 0.18;
export const TREE_CROWN_PROXY_MAX_DENSITY = 0.92;
export const TREE_CROWN_PROXY_EDGE_FALLOFF = 0.24;

export interface TreeCrownProxySpec {
  species: TreeSpeciesId;
  radiusXM: number;
  radiusYM: number;
  radiusZM: number;
  centerYM: number;
  density: number;
  edgeFalloff: number;
  bandFade: number;
}

export interface TreeCrownProxySample {
  localX: number;
  localY: number;
  localZ: number;
  worldX: number;
  worldZ: number;
}

export function treeCrownProxySpec(
  settings: Pick<TreeSettings, "species">,
  species: TreeSpeciesId,
  scale = 1,
  bandFade = 1,
): TreeCrownProxySpec {
  const cfg = settings.species[species];
  const safeScale = Math.max(0.001, scale);
  const radius = Math.max(0.001, cfg.crownRadiusM * safeScale);
  const radiusY = radius * Math.max(0.18, cfg.morphology.crownFlattening);
  return {
    species,
    radiusXM: radius,
    radiusYM: radiusY,
    radiusZM: radius * clamp(0.86 + cfg.morphology.branchSpread * 0.18, 0.82, 1.18),
    centerYM: cfg.trunkHeightM * safeScale + radiusY * 0.62,
    density: treeCrownProxyDensity(cfg),
    edgeFalloff: TREE_CROWN_PROXY_EDGE_FALLOFF,
    bandFade: clamp01(bandFade),
  };
}

export function treeCrownProxyDensity(cfg: TreeSpeciesSettings): number {
  const foliageMass = cfg.morphology.leafClusterCount + cfg.morphology.leafCardCount * 0.35;
  const branchMass = cfg.morphology.primaryBranchCount + cfg.morphology.secondaryBranchCount * 0.5;
  const raw = (foliageMass * 0.012 + branchMass * 0.018) * (1 - cfg.morphology.crownIrregularity * 0.18);
  return clamp(raw, TREE_CROWN_PROXY_MIN_DENSITY, TREE_CROWN_PROXY_MAX_DENSITY);
}

export function treeCrownProxyCoverage(sample: TreeCrownProxySample, spec: TreeCrownProxySpec): number {
  const nx = sample.localX / Math.max(0.001, spec.radiusXM);
  const ny = (sample.localY - spec.centerYM) / Math.max(0.001, spec.radiusYM);
  const nz = sample.localZ / Math.max(0.001, spec.radiusZM);
  const distance = Math.sqrt(nx * nx + ny * ny + nz * nz);
  const edge = clamp01((1 - distance) / Math.max(0.001, spec.edgeFalloff));
  return clamp01(edge * spec.density * spec.bandFade);
}

export function treeCrownProxyWorldHash(worldX: number, worldZ: number, seed: number): number {
  return fract(Math.sin(worldX * 12.9898 + worldZ * 78.233 + seed * 0.61803398875) * 43758.5453123);
}

export function treeCrownProxyKeepsSample(sample: TreeCrownProxySample, spec: TreeCrownProxySpec, seed: number): boolean {
  const coverage = treeCrownProxyCoverage(sample, spec);
  if (coverage <= 0) return false;
  if (coverage >= 1) return true;
  return treeCrownProxyWorldHash(sample.worldX, sample.worldZ, seed) < coverage;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function fract(value: number): number {
  return value - Math.floor(value);
}
