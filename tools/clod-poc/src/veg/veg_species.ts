/** Distinct deterministic growth-grammar presets for all runtime tree species. */

import * as THREE from "three";
import type { SpeciesParams } from "./veg_types.js";

export const OAK: SpeciesParams = {
  id: "oak",
  label: "Oak broadleaf",
  kind: "broadleaf",
  height: [13, 21],
  trunkRadiusK: 0.026,
  crown: "ellipsoid",
  asym: 0.34,
  levels: [
    { density: 0, whorl: 0, childStart: 0, childEnd: 0, angleBase: 0, angleTip: 0, lenRatio: 0, lenJitter: 0, radRatio: 0, segs: 10, wander: 0.065, gravitropism: 0.035, droop: 0, tipCurl: 0, taper: 1.18 },
    { density: 1.45, whorl: 0, childStart: 0.28, childEnd: 0.95, angleBase: 1.12, angleTip: 0.48, lenRatio: 0.59, lenJitter: 0.3, radRatio: 0.52, segs: 8, wander: 0.14, gravitropism: 0.075, droop: 0.18, tipCurl: 0.14, taper: 0.94 },
    { density: 2.55, whorl: 0, childStart: 0.22, childEnd: 0.98, angleBase: 0.98, angleTip: 0.56, lenRatio: 0.47, lenJitter: 0.35, radRatio: 0.5, segs: 5, wander: 0.16, gravitropism: 0.04, droop: 0.27, tipCurl: 0.1, taper: 0.9 },
    { density: 7.0, whorl: 0, childStart: 0.16, childEnd: 1, angleBase: 0.9, angleTip: 0.58, lenRatio: 0.29, lenJitter: 0.38, radRatio: 0.54, segs: 3, wander: 0.13, gravitropism: -0.015, droop: 0.16, tipCurl: 0.05, taper: 0.84, planar: 0.72 },
  ],
  foliage: {
    kind: "leafCluster", anchorLevel: 3, spacing: 0.125, tStart: 0.1,
    scale: [0.17, 0.25], tilt: 1, clusterSize: [2, 4], normalBend: 0.7,
    planarLeaves: true, card: { mode: "cross", sizeK: 2.25, bend: 0.1 },
    leaf: { len: 1, width: 0.46, shapePow: 1.2, fold: 0.3, curl: 0.2, needleCount: 0, brush: 0 },
  },
  flare: { amp: 0.62, height: 1.25, lobes: 6 },
  barkRepeats: 4,
  foliageColor: { r: 0.052, g: 0.128, b: 0.032, hueVar: 0.26 },
  brokenTop: 0,
  stubChance: 0.025,
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
    { density: 2.6, whorl: 0, childStart: 0.35, childEnd: 1, angleBase: 0.9, angleTip: 0.55, lenRatio: 0.32, lenJitter: 0.34, radRatio: 0.45, segs: 4, wander: 0.13, gravitropism: 0.06, droop: 0.16, tipCurl: 0.22, taper: 0.85 },
    { density: 4.2, whorl: 0, childStart: 0.4, childEnd: 1, angleBase: 0.8, angleTip: 0.5, lenRatio: 0.4, lenJitter: 0.4, radRatio: 0.5, segs: 2, wander: 0.15, gravitropism: 0.1, droop: 0.1, tipCurl: 0.15, taper: 0.8 },
  ],
  foliage: {
    kind: "needleSpray", anchorLevel: 3, spacing: 0.11, tStart: 0.3,
    scale: [0.26, 0.42], tilt: 0.55, clusterSize: [1, 1], normalBend: 0.66,
    card: { mode: "cross", sizeK: 2.2, bend: 0.05 },
    leaf: { len: 0.21, width: 0.018, shapePow: 1, fold: 0, curl: 0, needleCount: 88, brush: 1 },
  },
  flare: { amp: 0.42, height: 0.8, lobes: 4 },
  barkRepeats: 4,
  foliageColor: { r: 0.034, g: 0.082, b: 0.045, hueVar: 0.18 },
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
    { density: 1.8, whorl: 0, childStart: 0.2, childEnd: 1, angleBase: 1.1, angleTip: 0.7, lenRatio: 0.3, lenJitter: 0.5, radRatio: 0.4, segs: 3, wander: 0.2, gravitropism: -0.08, droop: 0.4, tipCurl: 0, taper: 0.7 },
  ],
  foliage: null,
  flare: { amp: 0.6, height: 0.9, lobes: 5 },
  barkRepeats: 4,
  foliageColor: { r: 0.1, g: 0.09, b: 0.07, hueVar: 0.1 },
  brokenTop: 0.62,
  stubChance: 0.28,
};

export const BIRCH: SpeciesParams = {
  id: "birch",
  label: "Birch broadleaf",
  kind: "broadleaf",
  height: [9, 15],
  trunkRadiusK: 0.015,
  crown: "column",
  asym: 0.26,
  levels: [
    { density: 0, whorl: 0, childStart: 0, childEnd: 0, angleBase: 0, angleTip: 0, lenRatio: 0, lenJitter: 0, radRatio: 0, segs: 11, wander: 0.05, gravitropism: 0.045, droop: 0, tipCurl: 0, taper: 1.1 },
    { density: 2.2, whorl: 0, childStart: 0.3, childEnd: 0.96, angleBase: 0.95, angleTip: 0.45, lenRatio: 0.4, lenJitter: 0.3, radRatio: 0.42, segs: 7, wander: 0.11, gravitropism: 0.02, droop: 0.4, tipCurl: -0.04, taper: 0.95 },
    { density: 3.8, whorl: 0, childStart: 0.3, childEnd: 1, angleBase: 0.8, angleTip: 0.5, lenRatio: 0.42, lenJitter: 0.34, radRatio: 0.5, segs: 4, wander: 0.14, gravitropism: -0.1, droop: 0.5, tipCurl: -0.05, taper: 0.9 },
    { density: 6, whorl: 0, childStart: 0.3, childEnd: 1, angleBase: 0.7, angleTip: 0.45, lenRatio: 0.35, lenJitter: 0.4, radRatio: 0.5, segs: 3, wander: 0.12, gravitropism: -0.3, droop: 0.7, tipCurl: -0.05, taper: 0.85, planar: 0.5 },
  ],
  foliage: {
    kind: "leafCluster", anchorLevel: 3, spacing: 0.11, tStart: 0.15,
    scale: [0.1, 0.16], tilt: 0.9, clusterSize: [2, 3], normalBend: 0.66,
    planarLeaves: true, card: { mode: "cross", sizeK: 2.3, bend: 0.12 },
    leaf: { len: 1, width: 0.55, shapePow: 1.4, fold: 0.22, curl: 0.3, needleCount: 0, brush: 0 },
  },
  flare: { amp: 0.32, height: 0.7, lobes: 4 },
  barkRepeats: 3,
  foliageColor: { r: 0.066, g: 0.14, b: 0.04, hueVar: 0.2 },
  brokenTop: 0,
  stubChance: 0.03,
};

export const WILLOW: SpeciesParams = {
  id: "willow",
  label: "Willow lowland broadleaf",
  kind: "broadleaf",
  height: [9, 17],
  trunkRadiusK: 0.03,
  crown: "irregular",
  asym: 0.46,
  levels: [
    { density: 0, whorl: 0, childStart: 0, childEnd: 0, angleBase: 0, angleTip: 0, lenRatio: 0, lenJitter: 0, radRatio: 0, segs: 11, wander: 0.14, gravitropism: 0.02, droop: 0, tipCurl: -0.05, taper: 1.05 },
    { density: 1.7, whorl: 0, childStart: 0.2, childEnd: 0.94, angleBase: 1.12, angleTip: 0.62, lenRatio: 0.62, lenJitter: 0.36, radRatio: 0.48, segs: 8, wander: 0.18, gravitropism: -0.08, droop: 0.48, tipCurl: -0.16, taper: 0.9 },
    { density: 3.2, whorl: 0, childStart: 0.2, childEnd: 0.98, angleBase: 0.88, angleTip: 0.55, lenRatio: 0.5, lenJitter: 0.4, radRatio: 0.5, segs: 5, wander: 0.2, gravitropism: -0.24, droop: 0.72, tipCurl: -0.2, taper: 0.86 },
    { density: 7.2, whorl: 0, childStart: 0.24, childEnd: 1, angleBase: 0.7, angleTip: 0.45, lenRatio: 0.42, lenJitter: 0.45, radRatio: 0.5, segs: 3, wander: 0.16, gravitropism: -0.42, droop: 0.9, tipCurl: -0.16, taper: 0.82, planar: 0.35 },
  ],
  foliage: {
    kind: "leafCluster", anchorLevel: 3, spacing: 0.1, tStart: 0.16,
    scale: [0.12, 0.19], tilt: 0.82, clusterSize: [2, 4], normalBend: 0.67,
    planarLeaves: true, card: { mode: "cross", sizeK: 2.15, bend: 0.18 },
    leaf: { len: 1, width: 0.3, shapePow: 1.65, fold: 0.18, curl: 0.36, needleCount: 0, brush: 0 },
  },
  flare: { amp: 0.7, height: 1.1, lobes: 7 },
  barkRepeats: 4,
  foliageColor: { r: 0.062, g: 0.15, b: 0.05, hueVar: 0.24 },
  brokenTop: 0,
  stubChance: 0.035,
};

export const SPRUCE: SpeciesParams = {
  id: "spruce",
  label: "Spruce conifer",
  kind: "conifer",
  height: [19, 27],
  trunkRadiusK: 0.017,
  crown: "cone",
  asym: 0.22,
  levels: [
    { density: 0, whorl: 0, childStart: 0, childEnd: 0, angleBase: 0, angleTip: 0, lenRatio: 0, lenJitter: 0, radRatio: 0, segs: 16, wander: 0.015, gravitropism: 0.05, droop: 0, tipCurl: 0, taper: 1 },
    { density: 5, whorl: 4, childStart: 0.09, childEnd: 0.985, angleBase: 1.78, angleTip: 0.55, lenRatio: 0.19, lenJitter: 0.2, radRatio: 0.32, segs: 6, wander: 0.06, gravitropism: -0.03, droop: 0.3, tipCurl: 0.28, taper: 1.05 },
    { density: 5.5, whorl: 0, childStart: 0.12, childEnd: 0.98, angleBase: 1.05, angleTip: 0.8, lenRatio: 0.24, lenJitter: 0.35, radRatio: 0.4, segs: 3, wander: 0.08, gravitropism: -0.05, droop: 0.45, tipCurl: 0.12, taper: 0.9, planar: 1 },
  ],
  foliage: {
    kind: "needleSpray", anchorLevel: 2, spacing: 0.16, tStart: 0.05,
    scale: [0.22, 0.35], tilt: 0.5, clusterSize: [1, 1], normalBend: 0.62,
    planarLeaves: true, card: { mode: "lying", sizeK: 2.6, bend: 0.04 },
    leaf: { len: 0.1, width: 0.024, shapePow: 1, fold: 0, curl: 0, needleCount: 30, brush: 0 },
  },
  flare: { amp: 0.5, height: 1, lobes: 5 },
  barkRepeats: 5,
  foliageColor: { r: 0.026, g: 0.068, b: 0.048, hueVar: 0.16 },
  brokenTop: 0,
  stubChance: 0.02,
};

export const VEG_TREE_SPECIES = {
  oak: OAK,
  pine: PINE,
  dead: DEAD,
  birch: BIRCH,
  willow: WILLOW,
  spruce: SPRUCE,
} as const;

export const VEG_BARK_COLOR: Record<keyof typeof VEG_TREE_SPECIES, THREE.Color> = {
  oak: new THREE.Color(0x46382b),
  pine: new THREE.Color(0x3c3429),
  dead: new THREE.Color(0x6a6258),
  birch: new THREE.Color(0xb9b6aa),
  willow: new THREE.Color(0x514331),
  spruce: new THREE.Color(0x342f29),
};
