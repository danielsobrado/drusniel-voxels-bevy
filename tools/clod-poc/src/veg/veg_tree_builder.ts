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

const CARD_ANCHOR_TARGETS: Record<VegLod, number> = {
  0: 320,
  1: 180,
  2: 64,
};

const SPECIES_CARD_SCALE: Record<string, number> = {
  oak: 2.1,
  pine: 1.55,
  dead: 0,
};

const CARD_WIND_WEIGHT = 0.65;
const CARD_FLUTTER = 0.45;
const CROSS_CARD_ROTATION = Math.PI * 0.5;

const cardAxis = new THREE.Vector3(0, 0, 1);
const cardRight = new THREE.Vector3();
const cardUp = new THREE.Vector3();
const cardNormal = new THREE.Vector3();
const cardColor = new THREE.Color();

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
    const cardAnchors = selectAnchors(skel.anchors, CARD_ANCHOR_TARGETS[opts.lod]);
    const meshAnchors = selectAnchors(skel.anchors, anchorTarget(sp, opts.lod));
    const folRng = rng.fork("foliage");
    const fromVert = g.vertCount;
    buildFoliageCards(g, sp, cardAnchors, folRng.fork("cards"), base);
    for (const anchor of meshAnchors) {
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

function buildFoliageCards(
  g: VegMeshGrower,
  sp: SpeciesParams,
  anchors: LeafAnchor[],
  rng: Rng,
  base: THREE.Color,
): void {
  const sizeK = SPECIES_CARD_SCALE[sp.id] ?? 1.8;
  if (sizeK <= 0) return;
  const crossCards = sp.kind !== "conifer";
  for (const anchor of anchors) {
    pushFoliageCard(g, anchor, rng, base, sp.foliageColor.hueVar, sizeK, 0);
    if (crossCards) pushFoliageCard(g, anchor, rng, base, sp.foliageColor.hueVar, sizeK * 0.85, CROSS_CARD_ROTATION);
  }
}

function pushFoliageCard(
  g: VegMeshGrower,
  anchor: LeafAnchor,
  rng: Rng,
  base: THREE.Color,
  hueVar: number,
  sizeK: number,
  roll: number,
): void {
  cardRight.set(1, 0, 0).applyAxisAngle(cardAxis, roll).applyQuaternion(anchor.quat).normalize();
  cardUp.set(0, 1, 0).applyAxisAngle(cardAxis, roll).applyQuaternion(anchor.quat).normalize();
  cardNormal.crossVectors(cardRight, cardUp).normalize();

  const hue = 1 + (anchor.hue + (rng.float() - 0.5) * 0.3) * hueVar;
  const age = 1 - anchor.age * 0.18;
  cardColor.setRGB(base.r * hue * age, base.g * hue * age, base.b * hue * age);

  const size = anchor.scale * sizeK * (0.82 + rng.float() * 0.32);
  const halfW = size * 0.42;
  const halfH = size * 0.5;
  const top = cardVertex(g, anchor.pos, 0, halfH, 0.5, 1);
  const right = cardVertex(g, anchor.pos, halfW, 0, 1, 0.5);
  const bottom = cardVertex(g, anchor.pos, 0, -halfH, 0.5, 0);
  const left = cardVertex(g, anchor.pos, -halfW, 0, 0, 0.5);
  g.tri(top, right, bottom);
  g.tri(top, bottom, left);
}

function cardVertex(
  g: VegMeshGrower,
  center: THREE.Vector3,
  x: number,
  y: number,
  u: number,
  v: number,
): number {
  return g.vertex(
    center.x + cardRight.x * x + cardUp.x * y,
    center.y + cardRight.y * x + cardUp.y * y,
    center.z + cardRight.z * x + cardUp.z * y,
    cardNormal.x,
    cardNormal.y,
    cardNormal.z,
    u,
    v,
    cardColor.r,
    cardColor.g,
    cardColor.b,
    CARD_WIND_WEIGHT,
    CARD_FLUTTER,
    1,
  );
}
