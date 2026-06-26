/**
 * Grammar species presets for clod-poc, keyed by the existing `TreeSpeciesId`
 * (oak / pine / dead). These keep the public IDs stable while moving the growth
 * parameters much closer to the reference vegetation implementation:
 * beech-like broadleaf → oak, mountain pine → pine, snag → dead.
 */

import * as THREE from "three";
import type { SpeciesParams } from "./veg_types.js";

export const OAK: SpeciesParams = {
  id: "oak",
  label: "Oak / beech-style broadleaf",
  kind: "broadleaf",
  height: [13, 20],
  trunkRadiusK: 0.024,
  crown: "ellipsoid",
  asym: 0.3,
  levels: [
    { density: 0, whorl: 0, childStart: 0, childEnd: 0, angleBase: 0, angleTip: 0, lenRatio: 0, lenJitter: 0, radRatio: 0, segs: 9, wander: 0.05, gravitropism: 0.04, droop: 0, tipCurl: 0, taper: 1.25 },
    { density: 1.5, whorl: 0, childStart: 0.32, childEnd: 0.94, angleBase: 1.05, angleTip: 0.5, lenRatio: 0.56, lenJitter: 0.26, radRatio: 0.5, segs: 8, wander: 0.1, gravitropism: 0.085, droop: 0.22, tipCurl: 0.12, taper: 0.95 },
    { density: 2.3, whorl: 0, childStart: 0.25, childEnd: 0.97, angleBase: 0.92, angleTip: 0.55, lenRatio: 0.46, lenJitter: 0.3, radRatio: 0.52, segs: 5, wander: 0.13, gravitropism: 0.05, droop: 0.3, tipCurl: 0.08, taper: 0.9 },
    { density: 8.0, whorl: 0, childStart: 0.15, childEnd: 1.0, angleBase: 0.9, angleTip: 0.6, lenRatio: 0.28, lenJitter: 0.35, radRatio: 0.55, segs: 3, wander: 0.1, gravitropism: -0.02, droop: 0.15, tipCurl: 0.04, taper: 0.85, planar: 1 },
  ],
  foliage: {
    kind: "leafCluster",
    anchorLevel: 3,
    spacing: 0.13,
    tStart: 0.1,
    scale: [0.16, 0.24],
    tilt: 1.0,
    clusterSize: [2, 3],
    normalBend: 0.7,
    planarLeaves: true,
    leaf: { len: 1.0, width: 0.42, shapePow: 1.15, fold: 0.32, curl: 0.22, needleCount: 0, brush: 0 },
  },
  flare: { amp: 0.55, height: 1.2, lobes: 6 },
  barkRepeats: 4,
  foliageColor: { r: 0.06, g: 0.145, b: 0.035, hueVar: 0.3 },
  brokenTop: 0,
  stubChance: 0.02,
};

export const PINE: SpeciesParams = {
  id: "pine",
  label: "Mountain pine",
  kind: "conifer",
  height: [12, 19],
  trunkRadiusK: 0.021,
  crown: "dome",
  asym: 0.34,
  levels: [
    { density: 0, whorl: 0, childStart: 0, childEnd: 0, angleBase: 0, angleTip: 0, lenRatio: 0, lenJitter: 0, radRatio: 0, segs: 12, wander: 0.06, gravitropism: 0.03, droop: 0, tipCurl: 0, taper: 0.92 },
    { density: 1.8, whorl: 3, childStart: 0.42, childEnd: 0.97, angleBase: 1.5, angleTip: 0.55, lenRatio: 0.45, lenJitter: 0.32, radRatio: 0.4, segs: 8, wander: 0.14, gravitropism: 0.08, droop: 0.3, tipCurl: 0.32, taper: 0.85 },
    { density: 2.6, whorl: 0, childStart: 0.35, childEnd: 1.0, angleBase: 0.9, angleTip: 0.55, lenRatio: 0.32, lenJitter: 0.34, radRatio: 0.45, segs: 4, wander: 0.13, gravitropism: 0.06, droop: 0.16, tipCurl: 0.22, taper: 0.85 },
    { density: 4.2, whorl: 0, childStart: 0.4, childEnd: 1.0, angleBase: 0.8, angleTip: 0.5, lenRatio: 0.4, lenJitter: 0.4, radRatio: 0.5, segs: 2, wander: 0.15, gravitropism: 0.1, droop: 0.1, tipCurl: 0.15, taper: 0.8 },
  ],
  foliage: {
    kind: "needleSpray",
    anchorLevel: 3,
    spacing: 0.11,
    tStart: 0.3,
    scale: [0.26, 0.42],
    tilt: 0.55,
    clusterSize: [1, 1],
    normalBend: 0.66,
    leaf: { len: 0.21, width: 0.018, shapePow: 1, fold: 0, curl: 0, needleCount: 88, brush: 1 },
  },
  flare: { amp: 0.42, height: 0.8, lobes: 4 },
  barkRepeats: 4,
  foliageColor: { r: 0.04, g: 0.092, b: 0.048, hueVar: 0.22 },
  brokenTop: 0,
  stubChance: 0.04,
};

export const DEAD: SpeciesParams = {
  id: "dead",
  label: "Dead standing snag",
  kind: "snag",
  height: [8, 15],
  trunkRadiusK: 0.022,
  crown: "cone",
  asym: 0.3,
  levels: [
    { density: 0, whorl: 0, childStart: 0, childEnd: 0, angleBase: 0, angleTip: 0, lenRatio: 0, lenJitter: 0, radRatio: 0, segs: 13, wander: 0.06, gravitropism: 0.04, droop: 0, tipCurl: 0, taper: 0.9 },
    { density: 2.4, whorl: 0, childStart: 0.2, childEnd: 0.97, angleBase: 1.6, angleTip: 0.85, lenRatio: 0.38, lenJitter: 0.45, radRatio: 0.32, segs: 6, wander: 0.14, gravitropism: -0.1, droop: 0.6, tipCurl: 0.05, taper: 0.75 },
    { density: 1.8, whorl: 0, childStart: 0.2, childEnd: 1.0, angleBase: 1.1, angleTip: 0.7, lenRatio: 0.3, lenJitter: 0.5, radRatio: 0.4, segs: 3, wander: 0.2, gravitropism: -0.08, droop: 0.4, tipCurl: 0, taper: 0.7 },
  ],
  foliage: null,
  flare: { amp: 0.6, height: 0.9, lobes: 5 },
  barkRepeats: 4,
  foliageColor: { r: 0.1, g: 0.09, b: 0.07, hueVar: 0.1 },
  brokenTop: 0.62,
  stubChance: 0.28,
};

/** Grammar species keyed by clod-poc TreeSpeciesId. */
export const VEG_TREE_SPECIES = { oak: OAK, pine: PINE, dead: DEAD } as const;

/** Bark base colour per species (hue-jittered per branch by the tube builder). */
export const VEG_BARK_COLOR: Record<keyof typeof VEG_TREE_SPECIES, THREE.Color> = {
  oak: new THREE.Color(0x5b3a22),
  pine: new THREE.Color(0x4f3a26),
  dead: new THREE.Color(0x7a6653),
};
