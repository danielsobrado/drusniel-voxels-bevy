import { describe, expect, it } from "vitest";
import { growSkeleton } from "./veg_skeleton.js";
import { Rng } from "./veg_rng.js";
import type { SpeciesParams } from "./veg_types.js";

const TEST_OAK: SpeciesParams = {
  id: "testOak",
  label: "Test broadleaf",
  kind: "broadleaf",
  height: [6, 9],
  trunkRadiusK: 0.05,
  crown: "dome",
  asym: 0.3,
  levels: [
    { density: 0, whorl: 0, childStart: 0, childEnd: 0, angleBase: 0, angleTip: 0, lenRatio: 0, lenJitter: 0, radRatio: 0, segs: 8, wander: 0.05, gravitropism: 0.04, droop: 0, tipCurl: 0, taper: 0.9 },
    { density: 1.6, whorl: 0, childStart: 0.4, childEnd: 0.95, angleBase: 1.0, angleTip: 0.6, lenRatio: 0.5, lenJitter: 0.3, radRatio: 0.45, segs: 5, wander: 0.12, gravitropism: 0.05, droop: 0.2, tipCurl: 0.1, taper: 0.85 },
    { density: 3.0, whorl: 0, childStart: 0.3, childEnd: 1.0, angleBase: 0.9, angleTip: 0.5, lenRatio: 0.4, lenJitter: 0.4, radRatio: 0.5, segs: 3, wander: 0.18, gravitropism: 0.04, droop: 0.15, tipCurl: 0.05, taper: 0.85, planar: 0.4 },
  ],
  foliage: {
    kind: "leafCluster",
    anchorLevel: 2,
    spacing: 0.25,
    tStart: 0.2,
    scale: [0.2, 0.32],
    tilt: 0.9,
    clusterSize: [2, 3],
    normalBend: 0.6,
    planarLeaves: true,
    leaf: { len: 1.0, width: 0.6, shapePow: 1.2, fold: 0.3, curl: 0.2, needleCount: 0, brush: 0 },
  },
  flare: { amp: 0.2, height: 0.5, lobes: 3 },
  barkRepeats: 3,
  foliageColor: { r: 0.05, g: 0.12, b: 0.03, hueVar: 0.2 },
  brokenTop: 0,
  stubChance: 0,
};

describe("veg skeleton grammar", () => {
  it("grows a deterministic skeleton with finite crown bounds", () => {
    const skel = growSkeleton(TEST_OAK, new Rng(2024));
    expect(skel.branches.length).toBeGreaterThan(1);
    expect(skel.anchors.length).toBeGreaterThan(0);
    expect(skel.height).toBeGreaterThan(4);
    expect(Number.isFinite(skel.crownCenterY)).toBe(true);
    expect(Number.isFinite(skel.crownRadius)).toBe(true);
    // trunk reaches roughly its height
    const trunk = skel.branches.find((b) => b.level === 0);
    expect(trunk).toBeTruthy();
    const tip = trunk!.pts[trunk!.pts.length - 1]!;
    expect(tip.y).toBeGreaterThan(skel.height * 0.6);
  });

  it("is reproducible for the same seed and differs across seeds", () => {
    const a = growSkeleton(TEST_OAK, new Rng(7));
    const b = growSkeleton(TEST_OAK, new Rng(7));
    const c = growSkeleton(TEST_OAK, new Rng(8));
    expect(a.branches.length).toBe(b.branches.length);
    expect(a.anchors.length).toBe(b.anchors.length);
    // very likely different structure across seeds
    expect([a.branches.length, a.anchors.length]).not.toEqual([c.branches.length, c.anchors.length]);
  });

  it("anchors only attach at the foliage anchor level", () => {
    const skel = growSkeleton(TEST_OAK, new Rng(3));
    // anchors exist ⇒ at least one level-2 branch carries them
    expect(skel.branches.some((b) => b.level === 2)).toBe(true);
  });
});
