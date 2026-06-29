import * as THREE from "three";
import type { TreeSettings, TreeSpeciesId } from "./tree_config.js";

export interface TreeCrownProxyDimensions {
  radiusX: number;
  radiusZ: number;
  height: number;
  centerY: number;
  density: number;
}

export const TREE_CROWN_PROXY_SEGMENTS = 10;
export const TREE_CROWN_PROXY_RINGS = 6;

export function treeCrownProxyDimensions(settings: TreeSettings, species: TreeSpeciesId): TreeCrownProxyDimensions {
  const config = settings.species[species];
  const crownRadius = Math.max(0, config.crownRadiusM);
  if (crownRadius <= 0 || config.morphology.leafClusterCount <= 0) {
    return { radiusX: 0.55, radiusZ: 0.55, height: 1.2, centerY: config.trunkHeightM * 0.72, density: 0.12 };
  }
  const irregularity = Math.max(0, config.morphology.crownIrregularity);
  const flattening = Math.max(0.25, config.morphology.crownFlattening);
  const density = clampNumber(
    0.32 + config.morphology.leafClusterCount / 32 + config.morphology.leafCardCount / 160 - irregularity * 0.18,
    0.28,
    0.92,
  );
  return {
    radiusX: crownRadius * (1.0 + irregularity * 0.22),
    radiusZ: crownRadius * (0.92 + irregularity * 0.18),
    height: Math.max(1.0, crownRadius * 1.65 * flattening),
    centerY: config.trunkHeightM + Math.max(0.5, crownRadius * 0.42 * flattening),
    density,
  };
}

export function createTreeCrownProxyGeometry(
  segments = TREE_CROWN_PROXY_SEGMENTS,
  rings = TREE_CROWN_PROXY_RINGS,
): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(1, Math.max(6, Math.floor(segments)), Math.max(4, Math.floor(rings)));
  geometry.name = "tree-crown-proxy-ellipsoid";
  return geometry;
}

export function treeCrownProxyKeepProbability(radial01: number, density: number, edgeSoftness = 0.22): number {
  const radial = clampNumber(radial01, 0, 1);
  const edge = 1 - smoothstepNumber(1 - clampNumber(edgeSoftness, 0.02, 0.75), 1, radial);
  return clampNumber(edge * clampNumber(density, 0, 1), 0, 1);
}

export function treeCrownProxyImpostorFade(
  distanceM: number,
  farDistanceM: number,
  impostorDistanceM: number,
  bandM: number,
): number {
  const band = Math.max(0, bandM);
  const start = Math.max(farDistanceM, impostorDistanceM - band);
  const end = Math.max(start + 0.001, impostorDistanceM);
  if (band <= 0) return distanceM <= impostorDistanceM ? 1 : 0;
  return 1 - smoothstepNumber(start, end, distanceM);
}

export function smoothstepNumber(edge0: number, edge1: number, x: number): number {
  const t = clampNumber((x - edge0) / Math.max(0.000001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
