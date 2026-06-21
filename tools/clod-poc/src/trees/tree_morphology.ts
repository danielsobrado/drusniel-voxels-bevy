import * as THREE from "three";
import { treeHash2 } from "./tree_hash.js";
import type { TreeLod, TreeSettings, TreeSpeciesId } from "./tree_config.js";

export interface TreeMorphologySeed {
  species: TreeSpeciesId;
  seed: number;
  lod: TreeLod;
}

export interface TreeBranchNode {
  start: THREE.Vector3;
  end: THREE.Vector3;
  radiusStart: number;
  radiusEnd: number;
  level: number;
  windWeight: number;
}

export interface TreeLeafCard {
  center: THREE.Vector3;
  width: number;
  height: number;
  rotationY: number;
  tilt: number;
  colorMix: number;
  windWeight: number;
  flutterWeight: number;
}

export interface TreeMorphology {
  branches: TreeBranchNode[];
  leafCards: TreeLeafCard[];
  crownCenters: THREE.Vector3[];
}

const SPECIES_SALT: Record<TreeSpeciesId, number> = {
  oak: 0x1f4d,
  pine: 0x2b67,
  dead: 0x35a9,
};

const LOD_SALT: Record<TreeLod, number> = {
  near: 0x11,
  mid: 0x23,
  far: 0x37,
  impostor: 0x41,
};

export function treeMorphologySeed(seed: number, species: TreeSpeciesId, lod: TreeLod): number {
  return (seed ^ SPECIES_SALT[species] ^ LOD_SALT[lod]) | 0;
}

export function buildTreeMorphology(
  species: TreeSpeciesId,
  lod: TreeLod,
  settings: TreeSettings,
): TreeMorphology {
  const config = settings.species[species];
  const morphology = config.morphology;
  const seed = treeMorphologySeed(settings.seed, species, lod);
  const branches = species === "pine"
    ? buildPineBranches(seed, lod, config.trunkHeightM, config.trunkRadiusM, morphology)
    : buildRadialBranches(seed, species, lod, config.trunkHeightM, config.trunkRadiusM, morphology);
  const crownCenters = buildCrownCenters(seed, species, config.trunkHeightM, config.crownRadiusM, branches, morphology);
  const leafCards = species === "dead" || isCheapLod(lod)
    ? []
    : species === "pine"
      ? buildPineLeafCards(seed, lod, config.trunkHeightM, config.crownRadiusM, branches, morphology, settings)
      : buildOakLeafCards(seed, lod, config.trunkHeightM, config.crownRadiusM, branches, morphology, settings);
  return { branches, leafCards, crownCenters };
}

function buildRadialBranches(
  seed: number,
  species: TreeSpeciesId,
  lod: TreeLod,
  trunkHeight: number,
  trunkRadius: number,
  morphology: TreeSettings["species"][TreeSpeciesId]["morphology"],
): TreeBranchNode[] {
  if (morphology.branchLevels <= 0) return [];
  if (isCheapLod(lod)) return species === "dead" ? buildDeadFarBranches(seed, trunkHeight, trunkRadius, morphology) : [];
  const primaryCount = Math.max(0, Math.round(morphology.primaryBranchCount * lodScale(lod, 1, 0.58, 0)));
  const branches: TreeBranchNode[] = [];
  for (let i = 0; i < primaryCount; i++) {
    const t = primaryCount <= 1 ? 0.65 : 0.42 + (i / (primaryCount - 1)) * 0.42;
    const angle = Math.PI * 2 * (i / Math.max(1, primaryCount) + random(seed, i, 1) * 0.16);
    const start = trunkPoint(seed, trunkHeight, trunkRadius, morphology.trunkBend, t);
    const outward = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const irregular = 0.82 + random(seed, i, 2) * 0.42;
    const deadTwist = species === "dead" ? signed(seed, i, 3) * morphology.crownIrregularity * 0.7 : 0;
    const length = morphology.branchLength * irregular * (1.08 - t * 0.32) * (species === "dead" ? 0.9 : 1);
    const upSweep = morphology.branchUpSweep + signed(seed, i, 4) * morphology.crownIrregularity * 0.22;
    const end = start.clone().add(outward.multiplyScalar(length * morphology.branchSpread));
    end.y += length * (upSweep + deadTwist);
    const radiusStart = trunkRadius * (species === "dead" ? 0.28 : 0.24) * (1 - t * 0.45);
    const radiusEnd = Math.max(trunkRadius * 0.045, radiusStart * (species === "dead" ? 0.26 : 0.34));
    branches.push({
      start,
      end,
      radiusStart,
      radiusEnd,
      level: 0,
      windWeight: species === "dead" ? 0.18 + t * 0.24 : 0.28 + t * 0.34,
    });

    if (lod !== "near" || morphology.branchLevels < 2 || morphology.secondaryBranchCount <= 0 || species === "dead") continue;
    for (let j = 0; j < morphology.secondaryBranchCount; j++) {
      const secondaryT = 0.48 + random(seed, i * 17 + j, 5) * 0.32;
      const secondaryStart = start.clone().lerp(end, secondaryT);
      const secondaryAngle = angle + signed(seed, i * 17 + j, 6) * 1.25 + (j % 2 === 0 ? 0.65 : -0.65);
      const secondaryOut = new THREE.Vector3(Math.cos(secondaryAngle), 0, Math.sin(secondaryAngle));
      const secondaryLength = length * (0.34 + random(seed, i * 17 + j, 7) * 0.18);
      const secondaryEnd = secondaryStart.clone().add(secondaryOut.multiplyScalar(secondaryLength));
      secondaryEnd.y += secondaryLength * (morphology.branchUpSweep * 0.8 + 0.12);
      branches.push({
        start: secondaryStart,
        end: secondaryEnd,
        radiusStart: radiusStart * 0.42,
        radiusEnd: radiusEnd * 0.55,
        level: 1,
        windWeight: 0.5 + t * 0.28,
      });
    }
  }
  return branches;
}

function buildPineBranches(
  seed: number,
  lod: TreeLod,
  trunkHeight: number,
  trunkRadius: number,
  morphology: TreeSettings["species"][TreeSpeciesId]["morphology"],
): TreeBranchNode[] {
  if (morphology.branchLevels <= 0) return [];
  if (isCheapLod(lod)) return [];
  const count = Math.max(0, Math.round(morphology.primaryBranchCount * lodScale(lod, 1, 0.56, 0)));
  const branches: TreeBranchNode[] = [];
  for (let i = 0; i < count; i++) {
    const t = count <= 1 ? 0.55 : 0.26 + (i / (count - 1)) * 0.66;
    const angle = Math.PI * 2 * ((i * 0.382) % 1 + random(seed, i, 11) * 0.08);
    const start = trunkPoint(seed, trunkHeight, trunkRadius, morphology.trunkBend, t);
    const lowerBranchBoost = 1.45 - t * 0.92;
    const length = morphology.branchLength * lowerBranchBoost * (0.9 + random(seed, i, 12) * 0.22);
    const end = start.clone().add(new THREE.Vector3(
      Math.cos(angle) * length * morphology.branchSpread,
      length * (morphology.branchUpSweep + 0.14 * (t - 0.45)),
      Math.sin(angle) * length * morphology.branchSpread,
    ));
    const radiusStart = trunkRadius * 0.2 * (1 - t * 0.55);
    branches.push({
      start,
      end,
      radiusStart,
      radiusEnd: Math.max(trunkRadius * 0.035, radiusStart * 0.3),
      level: 0,
      windWeight: 0.24 + t * 0.32,
    });
  }
  return branches;
}

function buildDeadFarBranches(
  seed: number,
  trunkHeight: number,
  trunkRadius: number,
  morphology: TreeSettings["species"][TreeSpeciesId]["morphology"],
): TreeBranchNode[] {
  const branches: TreeBranchNode[] = [];
  for (let i = 0; i < 2; i++) {
    const t = 0.55 + i * 0.18;
    const angle = Math.PI * 2 * (0.18 + i * 0.38 + random(seed, i, 21) * 0.08);
    const start = trunkPoint(seed, trunkHeight, trunkRadius, morphology.trunkBend, t);
    const length = morphology.branchLength * (0.45 + i * 0.12);
    branches.push({
      start,
      end: start.clone().add(new THREE.Vector3(
        Math.cos(angle) * length * morphology.branchSpread,
        length * (morphology.branchUpSweep + signed(seed, i, 22) * 0.16),
        Math.sin(angle) * length * morphology.branchSpread,
      )),
      radiusStart: trunkRadius * 0.16,
      radiusEnd: trunkRadius * 0.05,
      level: 0,
      windWeight: 0.22,
    });
  }
  return branches;
}

function buildCrownCenters(
  seed: number,
  species: TreeSpeciesId,
  trunkHeight: number,
  crownRadius: number,
  branches: TreeBranchNode[],
  morphology: TreeSettings["species"][TreeSpeciesId]["morphology"],
): THREE.Vector3[] {
  if (species === "dead" || crownRadius <= 0 || morphology.leafClusterCount <= 0) return [];
  const centers = branches
    .filter((branch) => branch.level === 0)
    .map((branch) => branch.end.clone());
  const target = Math.max(1, morphology.leafClusterCount);
  for (let i = centers.length; i < target; i++) {
    const angle = Math.PI * 2 * random(seed, i, 31);
    const radius = crownRadius * (0.24 + random(seed, i, 32) * 0.68);
    const yNoise = signed(seed, i, 33) * crownRadius * morphology.crownIrregularity;
    centers.push(new THREE.Vector3(
      Math.cos(angle) * radius,
      trunkHeight + crownRadius * (species === "pine" ? 0.85 : 0.62) + yNoise / Math.max(0.35, morphology.crownFlattening),
      Math.sin(angle) * radius,
    ));
  }
  return centers.slice(0, target);
}

function buildOakLeafCards(
  seed: number,
  lod: TreeLod,
  trunkHeight: number,
  crownRadius: number,
  branches: TreeBranchNode[],
  morphology: TreeSettings["species"][TreeSpeciesId]["morphology"],
  settings: TreeSettings,
): TreeLeafCard[] {
  const foliage = settings.foliage.oak;
  const count = settings.foliage.enabled
    ? lod === "near" ? foliage.cardCountNear : lod === "mid" ? foliage.cardCountMid : 0
    : Math.round(morphology.leafCardCount * lodScale(lod, 1, 0.48, 0));
  // Anchor foliage to the branch structure (a leafy mass clustered around each
  // branch's outer third → tip) instead of a free-floating crown volume.
  const level0 = branches.filter((branch) => branch.level === 0);
  const anchors = level0.length > 0 ? level0 : branches;
  if (count <= 0 || anchors.length === 0) return [];
  const cards: TreeLeafCard[] = [];
  for (let i = 0; i < count; i++) {
    const branch = anchors[i % anchors.length];
    const dir = branch.end.clone().sub(branch.start);
    const along = Math.min(1.1, 0.58 + random(seed, i, 41) * 0.55);
    const center = branch.start.clone().addScaledVector(dir, along);
    const spread = Math.min(crownRadius, foliage.clusterSpreadM * (0.4 + random(seed, i, 42) * 0.7));
    const sa = Math.PI * 2 * random(seed, i, 49);
    center.x += Math.cos(sa) * spread;
    center.z += Math.sin(sa) * spread;
    center.y += signed(seed, i, 43) * spread * 0.65 / Math.max(0.35, morphology.crownFlattening);
    center.y = Math.max(trunkHeight * 0.7, center.y);
    const sizeMix = 1 + signed(seed, i, 44) * foliage.cardSizeVariation;
    cards.push({
      center,
      width: foliage.cardWidthM * sizeMix,
      height: foliage.cardHeightM * sizeMix,
      rotationY: Math.PI * 2 * random(seed, i, 45),
      tilt: signed(seed, i, 46) * 0.5,
      colorMix: random(seed, i, 47),
      windWeight: 0.74 + random(seed, i, 48) * 0.22,
      flutterWeight: 0.48 + random(seed, i, 50) * 0.45,
    });
  }
  return cards;
}

function buildPineLeafCards(
  seed: number,
  lod: TreeLod,
  trunkHeight: number,
  crownRadius: number,
  branches: TreeBranchNode[],
  morphology: TreeSettings["species"][TreeSpeciesId]["morphology"],
  settings: TreeSettings,
): TreeLeafCard[] {
  const foliage = settings.foliage.pine;
  const count = settings.foliage.enabled
    ? lod === "near" ? foliage.cardCountNear : lod === "mid" ? foliage.cardCountMid : 0
    : Math.round(morphology.leafCardCount * lodScale(lod, 1, 0.5, 0));
  // Conifer fronds: cards strung along each branch from mid-branch through the tip,
  // drooping — anchored to the branch structure instead of a free-floating cone.
  const level0 = branches.filter((branch) => branch.level === 0);
  const anchors = level0.length > 0 ? level0 : branches;
  if (count <= 0 || anchors.length === 0) return [];
  const cards: TreeLeafCard[] = [];
  for (let i = 0; i < count; i++) {
    const branch = anchors[i % anchors.length];
    const dir = branch.end.clone().sub(branch.start);
    const along = 0.4 + random(seed, i, 51) * 0.75;
    const center = branch.start.clone().addScaledVector(dir, along);
    const jitter = foliage.clusterSpreadM * 0.3;
    center.x += signed(seed, i, 52) * jitter;
    center.z += signed(seed, i, 57) * jitter;
    center.y -= random(seed, i, 58) * crownRadius * 0.3; // fronds droop
    center.y = Math.max(trunkHeight * 0.35, center.y);
    const sizeMix = 1 + signed(seed, i, 56) * foliage.cardSizeVariation;
    cards.push({
      center,
      width: foliage.cardWidthM * sizeMix,
      height: foliage.cardHeightM * (1.25 + along * 0.5) * sizeMix, // longer toward tips
      rotationY: Math.atan2(dir.z, dir.x), // aligned along the branch
      tilt: -0.4 - random(seed, i, 53) * 0.35, // droop downward
      colorMix: random(seed, i, 54),
      windWeight: 0.62 + along * 0.24,
      flutterWeight: 0.24 + random(seed, i, 55) * 0.34,
    });
  }
  return cards;
}

export function trunkPoint(
  seed: number,
  trunkHeight: number,
  trunkRadius: number,
  trunkBend: number,
  t: number,
): THREE.Vector3 {
  const bendDistance = trunkHeight * trunkBend * 0.16;
  const bendAngle = Math.PI * 2 * random(seed, 0, 71);
  const secondaryAngle = bendAngle + Math.PI * 0.5;
  const curve = t * t * (3 - 2 * t);
  const wobble = Math.sin(t * Math.PI * 2.2 + random(seed, 1, 72) * Math.PI) * trunkRadius * trunkBend * 0.35;
  return new THREE.Vector3(
    Math.cos(bendAngle) * bendDistance * curve + Math.cos(secondaryAngle) * wobble,
    trunkHeight * t,
    Math.sin(bendAngle) * bendDistance * curve + Math.sin(secondaryAngle) * wobble,
  );
}

function lodScale(lod: TreeLod, near: number, mid: number, far: number): number {
  if (lod === "near") return near;
  if (lod === "mid") return mid;
  return far;
}

function isCheapLod(lod: TreeLod): boolean {
  return lod === "far" || lod === "impostor";
}

function random(seed: number, index: number, salt: number): number {
  return treeHash2(index + salt * 997, salt * 37, seed);
}

function signed(seed: number, index: number, salt: number): number {
  return random(seed, index, salt) * 2 - 1;
}
