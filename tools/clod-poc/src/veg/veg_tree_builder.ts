/**
 * Grammar species + seed → one renderable tree BufferGeometry.
 *
 * LOD 0 keeps the full branch hierarchy and combines captured-cluster cards with
 * real leaf/needle geometry. LOD 1/2 reduce bark hierarchy and use cards only.
 * Every LOD is generated from the same deterministic skeleton seed.
 */

import * as THREE from "three";
import { VegMeshGrower } from "./veg_mesh_grower.js";
import { buildLeafCluster, buildSprayAt } from "./veg_leaf_mesh.js";
import { growSkeleton } from "./veg_skeleton.js";
import { tubesForSkeleton } from "./veg_tube_mesh.js";
import type { Rng } from "./veg_rng.js";
import type { FoliageCardParams, GrowthInstance, LeafAnchor, SpeciesParams } from "./veg_types.js";

export type VegLod = 0 | 1 | 2;

export interface BuildTreeOpts {
  lod: VegLod;
  inst?: Partial<GrowthInstance>;
  barkColor: THREE.Color;
  vertexBudget?: number;
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

interface AnchorSelection {
  anchors: LeafAnchor[];
  scaleMultiplier: number;
}

const LOD_BARK_K: Record<VegLod, number> = { 0: 1, 1: 0.6, 2: 0.32 };
const CARD_WIND_WEIGHT = 0.65;
const CARD_FLUTTER = 0.45;
const CARD_Z = new THREE.Vector3(0, 0, 1);

const DEFAULT_CARD_TARGETS: Record<VegLod, number> = { 0: 900, 1: 520, 2: 160 };
const DEFAULT_MESH_TARGETS: Record<VegLod, number> = { 0: 650, 1: 0, 2: 0 };

const SPECIES_CARD_TARGETS: Record<string, Partial<Record<VegLod, number>>> = {
  oak: { 0: 1_200, 1: 700, 2: 220 },
  birch: { 0: 1_350, 1: 760, 2: 240 },
  willow: { 0: 1_200, 1: 680, 2: 220 },
  pine: { 0: 620, 1: 360, 2: 120 },
  spruce: { 0: 760, 1: 420, 2: 140 },
  dead: { 0: 0, 1: 0, 2: 0 },
};

const SPECIES_MESH_TARGETS: Record<string, number> = {
  oak: 720,
  birch: 900,
  willow: 760,
  pine: 240,
  spruce: 320,
  dead: 0,
};

const DEFAULT_CONIFER_CARD: FoliageCardParams = { mode: "lying", sizeK: 2.2, bend: 0.04 };
const DEFAULT_PINE_CARD: FoliageCardParams = { mode: "cross", sizeK: 2.1, bend: 0.05 };
const DEFAULT_BROADLEAF_CARD: FoliageCardParams = { mode: "cross", sizeK: 2.2, bend: 0.1 };
const EMPTY_CARD: FoliageCardParams = { mode: "lying", sizeK: 0 };

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

function cardTarget(sp: SpeciesParams, lod: VegLod): number {
  return SPECIES_CARD_TARGETS[sp.id]?.[lod] ?? DEFAULT_CARD_TARGETS[lod];
}

function meshTarget(sp: SpeciesParams, lod: VegLod): number {
  if (lod !== 0) return 0;
  return SPECIES_MESH_TARGETS[sp.id] ?? DEFAULT_MESH_TARGETS[lod];
}

function selectAnchors(
  anchors: LeafAnchor[],
  target: number,
  sizeCap: number,
): AnchorSelection {
  if (target <= 0 || anchors.length === 0) return { anchors: [], scaleMultiplier: 1 };
  if (!Number.isFinite(target) || anchors.length <= target) return { anchors, scaleMultiplier: 1 };
  const stride = Math.max(1, Math.ceil(anchors.length / target));
  return {
    anchors: anchors.filter((_, index) => index % stride === 0),
    scaleMultiplier: Math.min(sizeCap, Math.sqrt(stride) * 0.9 + 0.12),
  };
}

function budgetedAnchorTargets(
  sp: SpeciesParams,
  lod: VegLod,
  vertexBudget: number | undefined,
): { cardTarget: number; meshTarget: number } {
  const desiredCards = cardTarget(sp, lod);
  const desiredMesh = meshTarget(sp, lod);
  if (!sp.foliage || typeof vertexBudget !== "number" || !Number.isFinite(vertexBudget) || vertexBudget <= 0) {
    return { cardTarget: desiredCards, meshTarget: desiredMesh };
  }

  const planes = resolveCardParams(sp).mode === "cross" ? 2 : 1;
  const rows = (resolveCardParams(sp).bend ?? 0) !== 0 ? 3 : 1;
  const cardVertexCost = planes * (rows + 1) * 2;
  const leafVertexCost = sp.foliage.kind === "needleSpray"
    ? Math.max(64, sp.foliage.leaf.needleCount * 4 + 10)
    : 17 * Math.max(1, (sp.foliage.clusterSize[0] + sp.foliage.clusterSize[1]) * 0.5);
  const barkReserve = lod === 0 ? vertexBudget * 0.34 : lod === 1 ? vertexBudget * 0.42 : vertexBudget * 0.52;
  const foliageBudget = Math.max(0, vertexBudget - barkReserve);
  const meshBudget = lod === 0 ? foliageBudget * 0.64 : 0;
  const cardBudget = foliageBudget - meshBudget;

  return {
    cardTarget: Math.max(0, Math.min(desiredCards, Math.floor(cardBudget / Math.max(1, cardVertexCost)))),
    meshTarget: Math.max(0, Math.min(desiredMesh, Math.floor(meshBudget / Math.max(1, leafVertexCost)))),
  };
}

export function buildTree(sp: SpeciesParams, rng: Rng, opts: BuildTreeOpts): BuiltTree {
  const skel = growSkeleton(sp, rng, opts.inst);
  const anchorLevel = sp.foliage?.anchorLevel ?? 2;
  const grower = new VegMeshGrower();

  const maxLevel = opts.lod === 0
    ? 99
    : opts.lod === 1
      ? Math.max(1, anchorLevel - 1)
      : Math.max(1, anchorLevel - 2);
  tubesForSkeleton(grower, skel, rng.fork("tubes"), {
    lodK: LOD_BARK_K[opts.lod],
    uRepeats: sp.barkRepeats,
    barkColor: opts.barkColor,
    flare: { ...sp.flare, phase: rng.float() * Math.PI * 2 },
    maxLevel,
    branchStride: opts.lod === 2 ? 2 : 1,
  });

  if (sp.foliage && skel.anchors.length > 0) {
    const foliage = sp.foliage;
    const baseColor = new THREE.Color(sp.foliageColor.r, sp.foliageColor.g, sp.foliageColor.b);
    const crownCenter = new THREE.Vector3(0, skel.crownCenterY, 0);
    const crownRadius = Math.max(skel.crownRadius, (skel.height - skel.crownCenterY) * 0.9);
    const targets = budgetedAnchorTargets(sp, opts.lod, opts.vertexBudget);
    const cardSelection = selectAnchors(skel.anchors, targets.cardTarget, opts.lod === 1 ? 1.9 : opts.lod === 2 ? 2.8 : 1);
    const meshSelection = selectAnchors(skel.anchors, targets.meshTarget, 1);
    const foliageStart = grower.vertCount;

    buildFoliageCards(
      grower,
      sp,
      cardSelection.anchors,
      rng.fork("foliageCards"),
      baseColor,
      cardSelection.scaleMultiplier,
    );

    if (opts.lod === 0) {
      const meshRng = rng.fork("foliageMesh");
      for (const anchor of meshSelection.anchors) {
        if (foliage.kind === "needleSpray") {
          buildSprayAt(grower, anchor, foliage.leaf, meshRng, baseColor, sp.foliageColor.hueVar);
        } else {
          buildLeafCluster(grower, anchor, foliage.leaf, foliage.clusterSize, meshRng, baseColor, sp.foliageColor.hueVar);
        }
      }
    }

    grower.bendNormals(crownCenter, crownRadius, foliage.normalBend, foliageStart);
    grower.crownAO(crownCenter, crownRadius, 0.55, foliageStart);
  }

  const geometry = grower.build();
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return {
    geometry,
    stats: {
      tris: grower.triCount,
      branches: skel.branches.length,
      anchors: skel.anchors.length,
      height: skel.height,
    },
  };
}

function buildFoliageCards(
  grower: VegMeshGrower,
  sp: SpeciesParams,
  anchors: LeafAnchor[],
  rng: Rng,
  baseColor: THREE.Color,
  scaleMultiplier: number,
): void {
  const card = resolveCardParams(sp);
  if (card.sizeK <= 0) return;
  for (const anchor of anchors) pushFoliageCard(grower, anchor, rng, baseColor, sp.foliageColor.hueVar, card, scaleMultiplier);
}

function resolveCardParams(sp: SpeciesParams): FoliageCardParams {
  if (!sp.foliage || sp.kind === "snag") return EMPTY_CARD;
  if (sp.foliage.card) return sp.foliage.card;
  if (sp.id === "pine") return DEFAULT_PINE_CARD;
  if (sp.kind === "conifer") return DEFAULT_CONIFER_CARD;
  return DEFAULT_BROADLEAF_CARD;
}

function pushFoliageCard(
  grower: VegMeshGrower,
  anchor: LeafAnchor,
  rng: Rng,
  baseColor: THREE.Color,
  hueVar: number,
  card: FoliageCardParams,
  scaleMultiplier: number,
): void {
  const hue = 1 + (anchor.hue + (rng.float() - 0.5) * 0.3) * hueVar;
  const age = 1 - anchor.age * 0.18;
  cardColor.setRGB(baseColor.r * hue * age, baseColor.g * hue * age, baseColor.b * hue * age);

  const tile = rng.int(4);
  const u0 = (tile % 2) * 0.5;
  const v0 = Math.floor(tile / 2) * 0.5;
  const size = anchor.scale * card.sizeK * scaleMultiplier * (0.84 + rng.float() * 0.28);
  const roll = (rng.float() - 0.5) * 0.7;
  const bend = (card.bend ?? 0) * (0.75 + rng.float() * 0.5);
  const rows = bend !== 0 ? 3 : 1;

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
    cardRowPos.copy(anchor.pos).addScaledVector(cardOut, -0.08 * size);
    const baseVertex = grower.vertCount;

    for (let row = 0; row <= rows; row++) {
      const t = row / rows;
      const angle = bend * t;
      cardDirRow.copy(cardOut).multiplyScalar(Math.cos(angle)).addScaledVector(cardNormal, -Math.sin(angle));
      cardNrmRow.copy(cardNormal).multiplyScalar(Math.cos(angle)).addScaledVector(cardOut, Math.sin(angle)).normalize();

      for (let side = 0; side <= 1; side++) {
        cardPosition.copy(cardRowPos).addScaledVector(cardWidthAxis, (side - 0.5) * size);
        grower.vertex(
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
          1,
        );
      }
      if (row < rows) cardRowPos.addScaledVector(cardDirRow, size / rows);
    }

    for (let row = 0; row < rows; row++) {
      const offset = baseVertex + row * 2;
      grower.quad(offset, offset + 1, offset + 3, offset + 2);
    }
  }
}
