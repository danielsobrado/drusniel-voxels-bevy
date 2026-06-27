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
import type { FoliageCardParams, GrowthInstance, LeafAnchor, SpeciesParams } from "./veg_types.js";

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

const DEFAULT_CONIFER_CARD: FoliageCardParams = { mode: "lying", sizeK: 2.6, bend: 0.04 };
const DEFAULT_PINE_CARD: FoliageCardParams = { mode: "cross", sizeK: 2.2, bend: 0.05 };
const DEFAULT_BROADLEAF_CARD: FoliageCardParams = { mode: "cross", sizeK: 2.3, bend: 0.1 };
const EMPTY_CARD: FoliageCardParams = { mode: "lying", sizeK: 0 };

const CARD_WIND_WEIGHT = 0.65;
const CARD_FLUTTER = 0.45;

const cardRight = new THREE.Vector3();
const cardUp = new THREE.Vector3();
const cardOut = new THREE.Vector3();
const cardWidthAxis = new THREE.Vector3();
const cardNormal = new THREE.Vector3();
const cardRowPos = new THREE.Vector3();
const cardDirRow = new THREE.Vector3();
const cardNrmRow = new THREE.Vector3();
const cardPosition = new THREE.Vector3();
const cardColor = new THREE.Color();
const cardQuat = new THREE.Quaternion();
const cardRollQuat = new THREE.Quaternion();
const CARD_Z = new THREE.Vector3(0, 0, 1);

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
  const card = resolveCardParams(sp);
  if (card.sizeK <= 0) return;

  for (const anchor of anchors) {
    pushFoliageCard(g, anchor, rng, base, sp.foliageColor.hueVar, card);
  }
}

function resolveCardParams(sp: SpeciesParams): FoliageCardParams {
  if (!sp.foliage) return EMPTY_CARD;
  if (sp.foliage.card) return sp.foliage.card;
  if (sp.kind === "snag") return EMPTY_CARD;
  if (sp.id === "pine") return DEFAULT_PINE_CARD;
  if (sp.kind === "conifer") return DEFAULT_CONIFER_CARD;
  return DEFAULT_BROADLEAF_CARD;
}

function pushFoliageCard(
  g: VegMeshGrower,
  anchor: LeafAnchor,
  rng: Rng,
  base: THREE.Color,
  hueVar: number,
  card: FoliageCardParams,
): void {
  const hue = 1 + (anchor.hue + (rng.float() - 0.5) * 0.3) * hueVar;
  const age = 1 - anchor.age * 0.18;
  cardColor.setRGB(base.r * hue * age, base.g * hue * age, base.b * hue * age);

  const tile = rng.int(4);
  const u0 = (tile % 2) * 0.5;
  const v0 = Math.floor(tile / 2) * 0.5;
  const s = anchor.scale * card.sizeK * (0.82 + rng.float() * 0.32);
  const roll = (rng.float() - 0.5) * 0.7;
  const bend = (card.bend ?? 0) * (0.75 + rng.float() * 0.5);
  const rows = Math.abs(bend) > 1e-4 ? 3 : 1;

  cardQuat.copy(anchor.quat);
  cardRollQuat.setFromAxisAngle(CARD_Z, roll);
  cardQuat.multiply(cardRollQuat);
  cardRight.set(1, 0, 0).applyQuaternion(cardQuat).normalize();
  cardUp.set(0, 1, 0).applyQuaternion(cardQuat).normalize();
  cardOut.set(0, 0, 1).applyQuaternion(cardQuat).normalize();

  const planes = card.mode === "cross" ? 2 : 1;
  for (let plane = 0; plane < planes; plane++) {
    cardWidthAxis.copy(plane === 0 ? cardRight : cardUp);
    cardNormal.copy(plane === 0 ? cardUp : cardRight);
    const baseVertex = g.vertCount;
    cardRowPos.copy(anchor.pos).addScaledVector(cardOut, -0.08 * s);

    for (let row = 0; row <= rows; row++) {
      const t = row / rows;
      const angle = bend * t;
      cardDirRow.copy(cardOut).multiplyScalar(Math.cos(angle)).addScaledVector(cardNormal, -Math.sin(angle));
      cardNrmRow.copy(cardNormal).multiplyScalar(Math.cos(angle)).addScaledVector(cardOut, Math.sin(angle)).normalize();

      for (let side = 0; side <= 1; side++) {
        cardPosition.copy(cardRowPos).addScaledVector(cardWidthAxis, (side - 0.5) * s);
        g.vertex(
          cardPosition.x,
          cardPosition.y,
          cardPosition.z,
          cardNrmRow.x,
          cardNrmRow.y,
          cardNrmRow.z,
          u0 + side * 0.5,
          v0 + t * 0.5,
          cardColor.r,
          cardColor.g,
          cardColor.b,
          CARD_WIND_WEIGHT,
          CARD_FLUTTER,
          1,
        );
      }

      if (row < rows) cardRowPos.addScaledVector(cardDirRow, s / rows);
    }

    for (let row = 0; row < rows; row++) {
      const i = baseVertex + row * 2;
      g.quad(i, i + 1, i + 3, i + 2);
    }
  }
}
