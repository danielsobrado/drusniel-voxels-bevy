/**
 * Grammar species presets for clod-poc, keyed by the existing `TreeSpeciesId`
 * (oak / pine / dead). Adapted from the fable5-world-demo reference
 * (`vegetation/Species.ts`: BEECH → oak, PINE → pine, snag → dead) but tuned
 * LEAN: clod-poc instances trees through a tight vertex budget (near = 8000),
 * far below the reference's hero trees, so densities/levels are reduced.
 */

import * as THREE from "three";
import type { SpeciesParams } from "./veg_types.js";

export const OAK: SpeciesParams = {
  id: "oak",
  label: "Oak (broadleaf)",
  kind: "broadleaf",
  height: [7, 11],
  trunkRadiusK: 0.05,
  crown: "ellipsoid",
  asym: 0.3,
  levels: [
    { density: 0, whorl: 0, childStart: 0, childEnd: 0, angleBase: 0, angleTip: 0, lenRatio: 0, lenJitter: 0, radRatio: 0, segs: 7, wander: 0.05, gravitropism: 0.04, droop: 0, tipCurl: 0, taper: 1.1 },
    { density: 0.9, whorl: 0, childStart: 0.34, childEnd: 0.94, angleBase: 1.05, angleTip: 0.5, lenRatio: 0.56, lenJitter: 0.26, radRatio: 0.5, segs: 5, wander: 0.1, gravitropism: 0.08, droop: 0.22, tipCurl: 0.12, taper: 0.95 },
    { density: 1.6, whorl: 0, childStart: 0.2, childEnd: 1.0, angleBase: 0.92, angleTip: 0.55, lenRatio: 0.4, lenJitter: 0.3, radRatio: 0.52, segs: 3, wander: 0.13, gravitropism: 0.0, droop: 0.18, tipCurl: 0.06, taper: 0.88, planar: 0.5 },
  ],
  foliage: {
    kind: "leafCluster",
    anchorLevel: 2,
    spacing: 0.42,
    tStart: 0.15,
    scale: [0.22, 0.34],
    tilt: 1.0,
    clusterSize: [2, 3],
    normalBend: 0.7,
    planarLeaves: true,
    leaf: { len: 1.0, width: 0.42, shapePow: 1.15, fold: 0.32, curl: 0.22, needleCount: 0, brush: 0 },
  },
  flare: { amp: 0.5, height: 1.0, lobes: 5 },
  barkRepeats: 4,
  foliageColor: { r: 0.18, g: 0.36, b: 0.16, hueVar: 0.2 },
  brokenTop: 0,
  stubChance: 0.02,
};

export const PINE: SpeciesParams = {
  id: "pine",
  label: "Pine (conifer)",
  kind: "conifer",
  height: [11, 16],
  trunkRadiusK: 0.022,
  crown: "cone",
  asym: 0.28,
  levels: [
    { density: 0, whorl: 0, childStart: 0, childEnd: 0, angleBase: 0, angleTip: 0, lenRatio: 0, lenJitter: 0, radRatio: 0, segs: 10, wander: 0.05, gravitropism: 0.04, droop: 0, tipCurl: 0, taper: 0.95 },
    { density: 1.0, whorl: 4, childStart: 0.18, childEnd: 0.97, angleBase: 1.6, angleTip: 0.55, lenRatio: 0.34, lenJitter: 0.25, radRatio: 0.36, segs: 5, wander: 0.08, gravitropism: -0.02, droop: 0.3, tipCurl: 0.28, taper: 1.0 },
    { density: 2.4, whorl: 0, childStart: 0.15, childEnd: 0.98, angleBase: 1.0, angleTip: 0.7, lenRatio: 0.26, lenJitter: 0.3, radRatio: 0.42, segs: 3, wander: 0.1, gravitropism: -0.04, droop: 0.4, tipCurl: 0.12, taper: 0.9, planar: 1 },
  ],
  foliage: {
    kind: "needleSpray",
    anchorLevel: 2,
    spacing: 0.2,
    tStart: 0.1,
    scale: [0.14, 0.22],
    tilt: 0.55,
    clusterSize: [1, 1],
    normalBend: 0.64,
    planarLeaves: true,
    leaf: { len: 0.08, width: 0.02, shapePow: 1, fold: 0, curl: 0, needleCount: 14, brush: 0 },
  },
  flare: { amp: 0.42, height: 0.8, lobes: 4 },
  barkRepeats: 4,
  foliageColor: { r: 0.12, g: 0.26, b: 0.14, hueVar: 0.18 },
  brokenTop: 0,
  stubChance: 0.03,
};

export const DEAD: SpeciesParams = {
  id: "dead",
  label: "Dead snag",
  kind: "snag",
  height: [8, 12],
  trunkRadiusK: 0.03,
  crown: "irregular",
  asym: 0.4,
  levels: [
    { density: 0, whorl: 0, childStart: 0, childEnd: 0, angleBase: 0, angleTip: 0, lenRatio: 0, lenJitter: 0, radRatio: 0, segs: 8, wander: 0.12, gravitropism: 0.02, droop: 0, tipCurl: 0, taper: 1.0 },
    { density: 0.7, whorl: 0, childStart: 0.4, childEnd: 0.92, angleBase: 1.1, angleTip: 0.6, lenRatio: 0.42, lenJitter: 0.45, radRatio: 0.4, segs: 4, wander: 0.22, gravitropism: 0.04, droop: 0.18, tipCurl: 0, taper: 0.85 },
  ],
  foliage: null,
  flare: { amp: 0.45, height: 0.7, lobes: 4 },
  barkRepeats: 3,
  foliageColor: { r: 0.3, g: 0.26, b: 0.2, hueVar: 0.1 },
  brokenTop: 0.7,
  stubChance: 0.35,
};

/** Grammar species keyed by clod-poc TreeSpeciesId. */
export const VEG_TREE_SPECIES = { oak: OAK, pine: PINE, dead: DEAD } as const;

/** Bark base colour per species (hue-jittered per branch by the tube builder). */
export const VEG_BARK_COLOR: Record<keyof typeof VEG_TREE_SPECIES, THREE.Color> = {
  oak: new THREE.Color(0x5b3a22),
  pine: new THREE.Color(0x4f3a26),
  dead: new THREE.Color(0x7a6653),
};
