/**
 * Shared vegetation grammar types. Ported from the reference vegetation implementation.
 * (`vegetation/VegTypes.ts`). A species is a parameter bundle for the growth
 * grammar (`veg_skeleton.ts`) + meshing (`veg_tube_mesh.ts` / `veg_leaf_mesh.ts`).
 * Every plant is grown from its own deterministic Rng stream.
 */

import type { Quaternion, Vector3 } from "three";

/** Crown envelope: scales child-branch length by position along the parent. */
export type CrownShape = "cone" | "ellipsoid" | "dome" | "irregular" | "column";

/**
 * Per-level branching parameters. `levels[0]` is the trunk; `levels[i]`
 * describes level-i branches: their own geometry AND how they are distributed
 * on their (level i−1) parent.
 */
export interface LevelParams {
  /** children per meter of parent within the child t-range */
  density: number;
  /** 0 = spiral (golden angle) phyllotaxis; n ≥ 2 = whorls of n */
  whorl: number;
  /** parent-t range bearing these branches */
  childStart: number;
  childEnd: number;
  /** insertion angle (rad from parent tangent) at base/tip of that range */
  angleBase: number;
  angleTip: number;
  /** child length = parent length × lenRatio × crownEnvelope(t) */
  lenRatio: number;
  /** ± fraction of length jitter */
  lenJitter: number;
  /** child base radius = parent radius at t × radRatio */
  radRatio: number;
  /** polyline segments */
  segs: number;
  /** random direction wander per segment (rad) */
  wander: number;
  /** vertical response per segment: <0 droops, >0 rises toward up */
  gravitropism: number;
  /** progressive cantilever sag toward the tip (rad over the branch) */
  droop: number;
  /** upward curl concentrated at the tip (spruce secondaries) */
  tipCurl: number;
  /** radius falloff exponent along the branch */
  taper: number;
  /**
   * 0 = radial phyllotaxis; 1 = strictly two-sided in the bough plane
   * (conifer branchlets, distichous beech twigs). Fractions blend.
   */
  planar?: number;
}

export interface FoliageParams {
  kind: "needleSpray" | "leafCluster";
  /** branch level that carries anchors */
  anchorLevel: number;
  /** anchor spacing along the branch (m) */
  spacing: number;
  /** anchors begin at this t along the carrying branch */
  tStart: number;
  /** world scale of one spray/cluster (m) */
  scale: [number, number];
  /** outward tilt of sprays from the branch axis (rad) */
  tilt: number;
  /** leaves per cluster (leafCluster only) */
  clusterSize: [number, number];
  /** blend of geometric normal toward crown-sphere normal (0..1) */
  normalBend: number;
  /** leaves/sprays alternate two-sided along the twig (vs spiral) */
  planarLeaves?: boolean;
  /** species leaf geometry */
  leaf: LeafShapeParams;
}

export interface LeafShapeParams {
  /** single leaf length/width (m) — or needle length for sprays */
  len: number;
  width: number;
  /** width-profile exponent (1 ≈ ellipse, >1 pointier) */
  shapePow: number;
  /** fold along the midrib (V cross-section) */
  fold: number;
  /** downward curl along length */
  curl: number;
  /** needles per spray (needleSpray only) */
  needleCount: number;
  /** spray arrangement: 0 = flat comb, 1 = radial brush */
  brush: number;
}

export interface SpeciesParams {
  id: string;
  label: string;
  kind: "conifer" | "broadleaf" | "snag";
  /** mature height range (m) */
  height: [number, number];
  /** trunk base radius as a fraction of height */
  trunkRadiusK: number;
  crown: CrownShape;
  /** light-competition crown asymmetry strength (0..~0.5) */
  asym: number;
  levels: LevelParams[];
  foliage: FoliageParams | null;
  /** root flare: amplitude, height (m), buttress lobe count */
  flare: { amp: number; height: number; lobes: number };
  /** around-trunk bark UV repeats at the base */
  barkRepeats: number;
  /** base foliage albedo + per-instance hue swing */
  foliageColor: { r: number; g: number; b: number; hueVar: number };
  /** trunk broken at t (snags); 0 = intact */
  brokenTop: number;
  /** chance a branch is a stub (snags / damaged trees) */
  stubChance: number;
}

/** Continuous per-instance deformation inputs — beyond the seed. */
export interface GrowthInstance {
  /** world lean direction+magnitude (slope/wind response), |v| ~ 0..0.25 */
  leanX: number;
  leanZ: number;
  /** crown asymmetry bias direction (unit XZ) */
  biasX: number;
  biasZ: number;
  /** 0 young .. 1 old: scales height + branch density */
  age: number;
}

export interface SkelBranch {
  level: number;
  /** polyline points (world-local, tree origin at 0,0,0) */
  pts: Vector3[];
  /** radius at each point */
  radii: number[];
  /** unit tangent at each point */
  dirs: Vector3[];
  len: number;
  /** t along the parent where this branch attaches */
  tParent: number;
  /** broken/stub branches get a jagged cap */
  broken: boolean;
}

export interface LeafAnchor {
  pos: Vector3;
  quat: Quaternion;
  scale: number;
  /** per-anchor hue jitter (−1..1) */
  hue: number;
  /** 0 fresh .. 1 old/dry (inner/lower crown) */
  age: number;
}

export interface Skeleton {
  branches: SkelBranch[];
  anchors: LeafAnchor[];
  height: number;
  crownCenterY: number;
  crownRadius: number;
}
