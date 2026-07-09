import * as THREE from "three";
import { TREE_LODS, TREE_SPECIES, type TreeLod, type TreeSettings, type TreeSpeciesId } from "./tree_config.js";
import { buildTree } from "../veg/veg_tree_builder.js";
import { vegRng } from "../veg/veg_rng.js";
import { VEG_BARK_COLOR, VEG_TREE_SPECIES } from "../veg/veg_species.js";
import { TREE_STRUCTURAL_VARIANTS } from "./tree_instances.js";
import type { TreeImpostorAtlas } from "./tree_impostor_baker.js";
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
      for (const lod of TREE_LODS) {
        variants[variant][lod] = createTreeGeometry(species, variant, lod, settings);
      }
    }
    const speciesMap = {} as TreeSpeciesGeometryMap;
    for (const lod of TREE_LODS) {
      speciesMap[lod] = createTreeVariantSelectorGeometry(variants, lod);
    }
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
      ? config.crownRadiusM * 3.0
      : Math.max(config.trunkRadiusM * 4, config.morphology.branchLength * 1.6);
  const radius = atlas?.radius && Number.isFinite(atlas.radius)
    ? Math.max(0.25, atlas.radius)
    : Math.max(0.25, fallbackWidth * 0.5, fallbackHeight * 0.5);
  const centerY = atlas?.centerY && Number.isFinite(atlas.centerY)
    ? atlas.centerY
    : fallbackHeight * 0.5;
  const geometry = createTreeReferenceImpostorQuadGeometry(radius, centerY);
  setTreeVariantAttribute(geometry, 0);
  geometry.userData[TREE_IMPOSTOR_CARD_GEOMETRY_FLAG] = true;
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

/** Marks flat baked-impostor cards; billboard impostor materials may only be
 *  applied to geometry carrying this flag. */
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
} {
  return {
    vertexCount: geometry.getAttribute("position")?.count ?? 0,
    indexCount: geometry.getIndex()?.count ?? 0,
    maxWindWeight: maxAttributeComponent(geometry.getAttribute("treeWind"), "x"),
    maxFlutterWeight: maxAttributeComponent(geometry.getAttribute("treeWind"), "y"),
    colorCount: geometry.getAttribute("color")?.count ?? 0,
    maxFoliageMask: maxAttributeValue(geometry.getAttribute("treeFoliageMask")),
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
    setTreeVariantAttribute(geometry, variant);
    return geometry;
  }
  const sp = VEG_TREE_SPECIES[species];
  const rng = vegRng(settings.seed, `tree/${species}/${variant}`);
  const variantBudget = Math.max(1, Math.floor(settings.lod.budgets[TREE_LOD_VERTEX_BUDGET[lod]] / TREE_STRUCTURAL_VARIANTS));
  const built = buildTree(sp, rng, {
    lod: GRAMMAR_LOD[lod],
    barkColor: VEG_BARK_COLOR[species],
    vertexBudget: variantBudget,
  });
  const geometry = built.geometry;
  const target = targetTreeHeight(species, config);
  if (built.stats.height > 1e-3 && target > 1e-3) {
    const s = target / built.stats.height;
    geometry.scale(s, s, s);
  }
  setTreeVariantAttribute(geometry, variant);
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
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
  const treeVariants: number[] = [];
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
    appendAttribute(source, "treeWind", 2, wind, vertexCount);
    appendAttribute(source, "treeFoliageMask", 1, foliageMasks, vertexCount);
    for (let i = 0; i < vertexCount; i++) treeVariants.push(variant);

    const sourceIndex = source.getIndex();
    if (sourceIndex) {
      const array = sourceIndex.array;
      for (let i = 0; i < array.length; i++) indices.push(vertexOffset + Number(array[i]));
    } else {
      for (let i = 0; i < vertexCount; i++) indices.push(vertexOffset + i);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("treeWind", new THREE.Float32BufferAttribute(wind, 2));
  geometry.setAttribute("treeFoliageMask", new THREE.Float32BufferAttribute(foliageMasks, 1));
  geometry.setAttribute("treeVariant", new THREE.Float32BufferAttribute(treeVariants, 1));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}
