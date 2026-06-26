/**
 * Grammar species + seed → one renderable tree BufferGeometry (bark tubes +
 * real leaf/needle foliage merged into a single indexed buffer, matching the
 * clod-poc tree attribute contract: position/normal/color/uv/treeWind/
 * treeFoliageMask). Ported/adapted from the reference `vegetation/TreeBuilder.ts`.
 */

import * as THREE from "three";
import { VegMeshGrower } from "./veg_mesh_grower.js";
import { buildLeafCluster, buildSprayAt } from "./veg_leaf_mesh.js";
import { growSkeleton } from "./veg_skeleton.js";
import { tubesForSkeleton } from "./veg_tube_mesh.js";
import type { Rng } from "./veg_rng.js";
import type { GrowthInstance, LeafAnchor, SpeciesParams } from "./veg_types.js";

/** Discrete LOD for the grammar: 0 = near hero, 1 = mid, 2 = far. */
export type VegLod = 0 | 1 | 2;

export interface BuildTreeOpts {
  lod: VegLod;
  inst?: Partial<GrowthInstance>;
  /** bark base colour (hue-jittered per branch by the tube builder) */
  barkColor: THREE.Color;
}

export interface BuiltTreeStats {
  tris: number;
  branches: number;
  anchors: number;
  height: number;
}

export interface BuiltTree {
  geometry: THREE.BufferGeometry;
  stats: BuiltTreeStats;
}

const LOD_BARK_K: Record<VegLod, number> = { 0: 1, 1: 0.6, 2: 0.32 };

const DEFAULT_ANCHOR_TARGETS: Record<VegLod, number> = {
  0: 2200,
  1: 650,
  2: 180,
};

const SPECIES_ANCHOR_TARGETS: Record<string, Partial<Record<VegLod, number>>> = {
  pine: { 0: 420, 1: 220, 2: 90 },
  oak: { 0: 2600, 1: 850, 2: 240 },
  dead: { 0: Number.POSITIVE_INFINITY, 1: Number.POSITIVE_INFINITY, 2: Number.POSITIVE_INFINITY },
};

function anchorTarget(sp: SpeciesParams, lod: VegLod): number {
  return SPECIES_ANCHOR_TARGETS[sp.id]?.[lod] ?? DEFAULT_ANCHOR_TARGETS[lod];
}

function selectAnchors(anchors: LeafAnchor[], target: number): LeafAnchor[] {
  if (!Number.isFinite(target) || anchors.length <= target) return anchors;
  const stride = Math.max(1, Math.ceil(anchors.length / target));
  return anchors.filter((_, i) => i % stride === 0);
}

export function buildTree(sp: SpeciesParams, rng: Rng, opts: BuildTreeOpts): BuiltTree {
  const skel = growSkeleton(sp, rng, opts.inst);
  const anchorLevel = sp.foliage?.anchorLevel ?? 2;
  const g = new VegMeshGrower();

  const maxLevel = opts.lod === 0
    ? 99
    : opts.lod === 1
      ? Math.max(1, anchorLevel - 1)
      : Math.max(1, anchorLevel - 2);
  tubesForSkeleton(g, skel, rng.fork("tubes"), {
    lodK: LOD_BARK_K[opts.lod],
    uRepeats: sp.barkRepeats,
    barkColor: opts.barkColor,
    flare: { ...sp.flare, phase: rng.float() * Math.PI * 2 },
    maxLevel,
    branchStride: opts.lod === 2 ? 2 : 1,
  });

  if (sp.foliage && skel.anchors.length > 0) {
    const fol = sp.foliage;
    const base = new THREE.Color(sp.foliageColor.r, sp.foliageColor.g, sp.foliageColor.b);
    const crownC = new THREE.Vector3(0, skel.crownCenterY, 0);
    const crownR = Math.max(skel.crownRadius, (skel.height - skel.crownCenterY) * 0.9);
    const anchors = selectAnchors(skel.anchors, anchorTarget(sp, opts.lod));
    const folRng = rng.fork("foliage");
    const fromVert = g.vertCount;
    for (const anchor of anchors) {
      if (fol.kind === "needleSpray") buildSprayAt(g, anchor, fol.leaf, folRng, base, sp.foliageColor.hueVar);
      else buildLeafCluster(g, anchor, fol.leaf, fol.clusterSize, folRng, base, sp.foliageColor.hueVar);
    }
    g.bendNormals(crownC, crownR, fol.normalBend, fromVert);
    g.crownAO(crownC, crownR, 0.55, fromVert);
  }

  const geometry = g.build();
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return {
    geometry,
    stats: {
      tris: g.triCount,
      branches: skel.branches.length,
      anchors: skel.anchors.length,
      height: skel.height,
    },
  };
}
