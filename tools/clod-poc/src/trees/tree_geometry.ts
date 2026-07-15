import * as THREE from "three";
import { TREE_LODS, TREE_SPECIES, type TreeLod, type TreeSettings, type TreeSpeciesId } from "./tree_config.js";
import { buildTree } from "../veg/veg_tree_builder.js";
import { vegRng } from "../veg/veg_rng.js";
import { VEG_BARK_COLOR, VEG_TREE_SPECIES } from "../veg/veg_species.js";
import { TREE_STRUCTURAL_VARIANTS } from "./tree_instances.js";
import type { TreeImpostorAtlas } from "./tree_impostor_baker.js";
import { treeSpeciesAtlasIndex } from "./tree_alpha_mask.js";
import {
  type TreeVariantGeometryMap,
  type TreeSpeciesGeometryMap,
  type TreeGeometryMap,
  GeometryBuilder,
  GRAMMAR_LOD,
  TREE_LOD_VERTEX_BUDGET,
  targetTreeHeight,
  createOpaqueImpostorTree,
  appendAttribute,
  setTreeVariantAttribute,
  disposeGeometryOnce,
  ensureTreeMorphologyGeometryAttributes,
  unitFrame,
  maxAttributeValue,
  maxAttributeComponent,
} from "./tree_geometry_types.js";

export type { TreeVariantGeometryMap, TreeSpeciesGeometryMap, TreeGeometryMap, AtlasFrame } from "./tree_geometry_types.js";
export { GeometryBuilder, GRAMMAR_LOD, TREE_LOD_VERTEX_BUDGET, unitFrame, maxAttributeValue, maxAttributeComponent, disposeGeometryOnce, createOpaqueImpostorTree } from "./tree_geometry_types.js";
export {
  OAK_LEAF_LOW, OAK_LEAF_HIGH, PINE_LEAF_LOW, PINE_LEAF_HIGH, DEAD_BARK,
} from "./tree_geometry_types.js";

export function createTreeGeometryMap(settings: TreeSettings): TreeGeometryMap {
  const out = {} as TreeGeometryMap;
  for (const species of TREE_SPECIES) {
    const variants = {} as TreeVariantGeometryMap;
    for (let variant = 0; variant < TREE_STRUCTURAL_VARIANTS; variant++) {
      variants[variant] = {} as Record<TreeLod, THREE.BufferGeometry>;
      for (const lod of TREE_LODS) variants[variant][lod] = createTreeGeometry(species, variant, lod, settings);
    }
    const speciesMap = {} as TreeSpeciesGeometryMap;
    for (const lod of TREE_LODS) speciesMap[lod] = createTreeVariantSelectorGeometry(variants, lod);
    speciesMap.variants = variants;
    out[species] = speciesMap;
  }
  return out;
}

export function disposeTreeGeometryMap(map: TreeGeometryMap): void {
  const disposed = new Set<THREE.BufferGeometry>();
  for (const species of TREE_SPECIES) {
    const speciesMap = map[species];
    for (const lod of TREE_LODS) disposeGeometryOnce(speciesMap[lod], disposed);
    const variants = speciesMap.variants ?? { 0: speciesMap };
    for (const variant of Object.values(variants)) {
      for (const lod of TREE_LODS) disposeGeometryOnce(variant[lod], disposed);
    }
  }
}

export function treeGeometryKey(settings: TreeSettings): string {
  return JSON.stringify({
    seed: settings.seed,
    variants: TREE_STRUCTURAL_VARIANTS,
    variantSelector: true,
    budgets: settings.lod.budgets,
    species: TREE_SPECIES.map((species) => {
      const config = settings.species[species];
      return {
        trunkHeightM: config.trunkHeightM,
        trunkRadiusM: config.trunkRadiusM,
        crownRadiusM: config.crownRadiusM,
        morphology: config.morphology,
      };
    }),
    foliage: settings.foliage,
  });
}

export function createTreeBakedImpostorGeometry(
  species: TreeSpeciesId,
  settings: TreeSettings,
  atlas?: Pick<TreeImpostorAtlas, "radius" | "centerY">,
): THREE.BufferGeometry {
  const config = settings.species[species];
  const fallbackHeight = species === "pine"
    ? config.trunkHeightM + config.crownRadiusM * 2.85 * config.morphology.crownFlattening
    : species === "oak"
      ? config.trunkHeightM + config.crownRadiusM * 1.7 / Math.max(0.55, config.morphology.crownFlattening)
      : config.trunkHeightM * 1.08;
  const fallbackWidth = species === "pine"
    ? config.crownRadiusM * 1.9
    : species === "oak"
      ? config.crownRadiusM * 3
      : Math.max(config.trunkRadiusM * 4, config.morphology.branchLength * 1.6);
  const radius = atlas?.radius && Number.isFinite(atlas.radius)
    ? Math.max(0.25, atlas.radius)
    : Math.max(0.25, fallbackWidth * 0.5, fallbackHeight * 0.5);
  const centerY = atlas?.centerY && Number.isFinite(atlas.centerY)
    ? atlas.centerY
    : fallbackHeight * 0.5;
  const geometry = createTreeReferenceImpostorQuadGeometry(radius, centerY);
  ensureTreeMorphologyGeometryAttributes(geometry);
  setTreeVariantAttribute(geometry, 0);
  packTreeSpeciesIntoWind(geometry, species);
  packTreeVertexAttributes(geometry);
  geometry.userData[TREE_IMPOSTOR_CARD_GEOMETRY_FLAG] = true;
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

export const TREE_IMPOSTOR_CARD_GEOMETRY_FLAG = "treeImpostorCard";

export function isTreeImpostorCardGeometry(geometry: THREE.BufferGeometry): boolean {
  return geometry.userData[TREE_IMPOSTOR_CARD_GEOMETRY_FLAG] === true;
}

export function createTreeReferenceImpostorQuadGeometry(radius: number, centerY: number): THREE.BufferGeometry {
  const safeRadius = Math.max(0.25, Number.isFinite(radius) ? radius : 1);
  const safeCenterY = Number.isFinite(centerY) ? centerY : safeRadius;
  const builder = new GeometryBuilder();
  builder.addFlatCard(
    new THREE.Vector3(0, safeCenterY, 0),
    safeRadius * 2,
    safeRadius * 2,
    0, 0,
    new THREE.Color(0xffffff),
    0.08, 0,
    unitFrame(), 1,
  );
  return builder.build();
}

export function treeGeometrySummary(geometry: THREE.BufferGeometry): {
  vertexCount: number;
  indexCount: number;
  maxWindWeight: number;
  maxFlutterWeight: number;
  colorCount: number;
  maxFoliageMask: number;
  maxFoliageCard: number;
  maxSpeciesIndex: number;
} {
  return {
    vertexCount: geometry.getAttribute("position")?.count ?? 0,
    indexCount: geometry.getIndex()?.count ?? 0,
    maxWindWeight: maxAttributeComponent(geometry.getAttribute("treeWind"), "x"),
    maxFlutterWeight: maxAttributeComponent(geometry.getAttribute("treeWind"), "y"),
    colorCount: geometry.getAttribute("color")?.count ?? 0,
    maxFoliageMask: maxAttributeValue(geometry.getAttribute("treeFoliageMask")),
    maxFoliageCard: maxAttributeValue(geometry.getAttribute("treeFoliageCard")),
    maxSpeciesIndex: maxAttributeComponent(geometry.getAttribute("treeWind"), "z"),
  };
}

export function treeGeometryVariant(
  map: TreeGeometryMap,
  species: TreeSpeciesId,
  variant: number,
  lod: TreeLod,
): THREE.BufferGeometry {
  const safeVariant = Math.max(0, Math.min(TREE_STRUCTURAL_VARIANTS - 1, Math.floor(variant)));
  return map[species].variants?.[safeVariant]?.[lod] ?? map[species][lod];
}

function createTreeGeometry(
  species: TreeSpeciesId,
  variant: number,
  lod: TreeLod,
  settings: TreeSettings,
): THREE.BufferGeometry {
  const config = settings.species[species];
  if (lod === "impostor" || (species === "dead" && lod === "far")) {
    const geometry = createOpaqueImpostorTree(species, config);
    ensureTreeMorphologyGeometryAttributes(geometry);
    setTreeVariantAttribute(geometry, variant);
    packTreeSpeciesIntoWind(geometry, species);
    packTreeVertexAttributes(geometry);
    return geometry;
  }
  const grammar = VEG_TREE_SPECIES[species];
  const rng = vegRng(settings.seed, `tree/${species}/${variant}`);
  const variantBudget = Math.max(
    1,
    Math.floor(settings.lod.budgets[TREE_LOD_VERTEX_BUDGET[lod]] / TREE_STRUCTURAL_VARIANTS),
  );
  const built = buildTree(grammar, rng, {
    lod: GRAMMAR_LOD[lod],
    barkColor: VEG_BARK_COLOR[species],
    vertexBudget: variantBudget,
  });
  const geometry = built.geometry;
  const target = targetTreeHeight(species, config);
  if (built.stats.height > 1e-3 && target > 1e-3) {
    const scale = target / built.stats.height;
    geometry.scale(scale, scale, scale);
  }
  setTreeVariantAttribute(geometry, variant);
  packTreeSpeciesIntoWind(geometry, species);
  packTreeVertexAttributes(geometry);
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

function packTreeSpeciesIntoWind(geometry: THREE.BufferGeometry, species: TreeSpeciesId): void {
  const positionCount = geometry.getAttribute("position")?.count ?? 0;
  const source = geometry.getAttribute("treeWind");
  const speciesIndex = treeSpeciesAtlasIndex(species);
  const packed = new Float32Array(positionCount * 3);
  for (let index = 0; index < positionCount; index++) {
    packed[index * 3] = source?.getX(index) ?? 0;
    packed[index * 3 + 1] = source?.getY(index) ?? 0;
    packed[index * 3 + 2] = speciesIndex;
  }
  geometry.setAttribute("treeWind", new THREE.Float32BufferAttribute(packed, 3));
  geometry.deleteAttribute("treeSpeciesIndex");
}

function packTreeVertexAttributes(geometry: THREE.BufferGeometry): void {
  const count = geometry.getAttribute("position")?.count ?? 0;
  const wind = geometry.getAttribute("treeWind");
  const foliageMask = geometry.getAttribute("treeFoliageMask");
  const foliageCard = geometry.getAttribute("treeFoliageCard");
  const height = geometry.getAttribute("treeHeight01");
  const radial = geometry.getAttribute("treeRadial01");
  const branchLevel = geometry.getAttribute("treeBranchLevel");
  const branchPhase = geometry.getAttribute("treeBranchPhase");
  const rootMask = geometry.getAttribute("treeRootMask");
  const variant = geometry.getAttribute("treeVariant");
  const packed = new Float32Array(count * 11);
  for (let index = 0; index < count; index++) {
    const offset = index * 11;
    packed[offset] = wind?.getX(index) ?? 0;
    packed[offset + 1] = wind?.getY(index) ?? 0;
    packed[offset + 2] = wind?.getZ(index) ?? 0;
    packed[offset + 3] = foliageMask?.getX(index) ?? 0;
    packed[offset + 4] = foliageCard?.getX(index) ?? 0;
    packed[offset + 5] = height?.getX(index) ?? 0;
    packed[offset + 6] = radial?.getX(index) ?? 0;
    packed[offset + 7] = branchLevel?.getX(index) ?? 0;
    packed[offset + 8] = branchPhase?.getX(index) ?? 0;
    packed[offset + 9] = rootMask?.getX(index) ?? 0;
    packed[offset + 10] = variant?.getX(index) ?? 0;
  }
  const buffer = new THREE.InterleavedBuffer(packed, 11);
  geometry.setAttribute("treeWind", new THREE.InterleavedBufferAttribute(buffer, 3, 0));
  geometry.setAttribute("treeFoliageMask", new THREE.InterleavedBufferAttribute(buffer, 1, 3));
  geometry.setAttribute("treeFoliageCard", new THREE.InterleavedBufferAttribute(buffer, 1, 4));
  geometry.setAttribute("treeHeight01", new THREE.InterleavedBufferAttribute(buffer, 1, 5));
  geometry.setAttribute("treeRadial01", new THREE.InterleavedBufferAttribute(buffer, 1, 6));
  geometry.setAttribute("treeBranchLevel", new THREE.InterleavedBufferAttribute(buffer, 1, 7));
  geometry.setAttribute("treeBranchPhase", new THREE.InterleavedBufferAttribute(buffer, 1, 8));
  geometry.setAttribute("treeRootMask", new THREE.InterleavedBufferAttribute(buffer, 1, 9));
  geometry.setAttribute("treeVariant", new THREE.InterleavedBufferAttribute(buffer, 1, 10));
}

function createTreeVariantSelectorGeometry(
  variants: TreeVariantGeometryMap,
  lod: TreeLod,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const wind: number[] = [];
  const foliageMasks: number[] = [];
  const foliageCards: number[] = [];
  const treeVariants: number[] = [];
  const treeHeight01: number[] = [];
  const treeRadial01: number[] = [];
  const treeBranchLevel: number[] = [];
  const treeBranchPhase: number[] = [];
  const treeRootMask: number[] = [];
  const indices: number[] = [];

  const entries = Object.entries(variants)
    .map(([variant, geometry]) => [Number(variant), geometry] as const)
    .sort(([a], [b]) => a - b);

  for (const [variant, geometryByLod] of entries) {
    const source = geometryByLod[lod];
    const vertexCount = source.getAttribute("position")?.count ?? 0;
    const vertexOffset = positions.length / 3;
    appendAttribute(source, "position", 3, positions, vertexCount);
    appendAttribute(source, "normal", 3, normals, vertexCount);
    appendAttribute(source, "color", 3, colors, vertexCount);
    appendAttribute(source, "uv", 2, uvs, vertexCount);
    appendAttribute(source, "treeWind", 3, wind, vertexCount);
    appendAttribute(source, "treeFoliageMask", 1, foliageMasks, vertexCount);
    appendAttribute(source, "treeFoliageCard", 1, foliageCards, vertexCount);
    appendAttribute(source, "treeHeight01", 1, treeHeight01, vertexCount);
    appendAttribute(source, "treeRadial01", 1, treeRadial01, vertexCount);
    appendAttribute(source, "treeBranchLevel", 1, treeBranchLevel, vertexCount);
    appendAttribute(source, "treeBranchPhase", 1, treeBranchPhase, vertexCount);
    appendAttribute(source, "treeRootMask", 1, treeRootMask, vertexCount);
    for (let index = 0; index < vertexCount; index++) treeVariants.push(variant);

    const sourceIndex = source.getIndex();
    if (sourceIndex) {
      const array = sourceIndex.array;
      for (let index = 0; index < array.length; index++) indices.push(vertexOffset + Number(array[index]));
    } else {
      for (let index = 0; index < vertexCount; index++) indices.push(vertexOffset + index);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("treeWind", new THREE.Float32BufferAttribute(wind, 3));
  geometry.setAttribute("treeFoliageMask", new THREE.Float32BufferAttribute(foliageMasks, 1));
  geometry.setAttribute("treeFoliageCard", new THREE.Float32BufferAttribute(foliageCards, 1));
  const morphologyPacked = new Float32Array(treeHeight01.length * 6);
  for (let index = 0; index < treeHeight01.length; index++) {
    morphologyPacked[index * 6] = treeHeight01[index] ?? 0;
    morphologyPacked[index * 6 + 1] = treeRadial01[index] ?? 0;
    morphologyPacked[index * 6 + 2] = treeBranchLevel[index] ?? 0;
    morphologyPacked[index * 6 + 3] = treeBranchPhase[index] ?? 0;
    morphologyPacked[index * 6 + 4] = treeRootMask[index] ?? 0;
    morphologyPacked[index * 6 + 5] = treeVariants[index] ?? 0;
  }
  const morphologyBuffer = new THREE.InterleavedBuffer(morphologyPacked, 6);
  geometry.setAttribute("treeHeight01", new THREE.InterleavedBufferAttribute(morphologyBuffer, 1, 0));
  geometry.setAttribute("treeRadial01", new THREE.InterleavedBufferAttribute(morphologyBuffer, 1, 1));
  geometry.setAttribute("treeBranchLevel", new THREE.InterleavedBufferAttribute(morphologyBuffer, 1, 2));
  geometry.setAttribute("treeBranchPhase", new THREE.InterleavedBufferAttribute(morphologyBuffer, 1, 3));
  geometry.setAttribute("treeRootMask", new THREE.InterleavedBufferAttribute(morphologyBuffer, 1, 4));
  geometry.setAttribute("treeVariant", new THREE.InterleavedBufferAttribute(morphologyBuffer, 1, 5));
  packTreeVertexAttributes(geometry);
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}
