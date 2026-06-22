/**
 * Grammar species + seed → one renderable tree BufferGeometry (bark tubes +
 * real leaf/needle foliage merged into a single indexed buffer, matching the
 * clod-poc tree attribute contract: position/normal/color/uv/treeWind/
 * treeFoliageMask). Ported/adapted from the reference `vegetation/TreeBuilder.ts`,
 * mesh-only foliage (the alpha-card atlas path is retired in clod-poc).
 */

import * as THREE from "three";
import { VegMeshGrower } from "./veg_mesh_grower.js";
import { buildLeafCluster, buildSprayAt } from "./veg_leaf_mesh.js";
import { growSkeleton } from "./veg_skeleton.js";
import { tubesForSkeleton } from "./veg_tube_mesh.js";
import type { Rng } from "./veg_rng.js";
import type { GrowthInstance, SpeciesParams } from "./veg_types.js";

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

const lodK = (lod: VegLod): number => (lod === 0 ? 1 : lod === 1 ? 0.6 : 0.32);
const foliageStride = (lod: VegLod): number => (lod === 0 ? 1 : lod === 1 ? 2 : 4);

export function buildTree(sp: SpeciesParams, rng: Rng, opts: BuildTreeOpts): BuiltTree {
  const skel = growSkeleton(sp, rng, opts.inst);
  const anchorLevel = sp.foliage?.anchorLevel ?? 2;
  const g = new VegMeshGrower();

  const maxLevel = opts.lod === 0 ? 99 : opts.lod === 1 ? Math.max(1, anchorLevel - 1) : Math.max(1, anchorLevel - 2);
  tubesForSkeleton(g, skel, rng.fork("tubes"), {
    lodK: lodK(opts.lod),
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
    const stride = foliageStride(opts.lod);
    const anchors = stride > 1 ? skel.anchors.filter((_, i) => i % stride === 0) : skel.anchors;
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
