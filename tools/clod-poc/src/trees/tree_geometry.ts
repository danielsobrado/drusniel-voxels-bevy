import * as THREE from "three";
import { TREE_LODS, TREE_SPECIES, type TreeLod, type TreeSettings, type TreeSpeciesId } from "./tree_config.js";
import { foliageAtlasCell } from "./tree_alpha_mask.js";
import { buildTree, type VegLod } from "../veg/veg_tree_builder.js";
import { vegRng } from "../veg/veg_rng.js";
import { VEG_BARK_COLOR, VEG_TREE_SPECIES } from "../veg/veg_species.js";
import { TREE_STRUCTURAL_VARIANTS } from "./tree_instances.js";

export type TreeVariantGeometryMap = Record<number, Record<TreeLod, THREE.BufferGeometry>>;
export type TreeSpeciesGeometryMap = Record<TreeLod, THREE.BufferGeometry> & { variants: TreeVariantGeometryMap };
export type TreeGeometryMap = Record<TreeSpeciesId, TreeSpeciesGeometryMap>;

const BARK = new THREE.Color(0x5b3a22);
const DEAD_BARK = new THREE.Color(0x7a6653);
const OAK_LEAF_LOW = new THREE.Color(0x2c6f36);
const OAK_LEAF_HIGH = new THREE.Color(0x4f9a42);
const PINE_LEAF_LOW = new THREE.Color(0x1d4e32);
const PINE_LEAF_HIGH = new THREE.Color(0x367142);

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
    const speciesMap = variants[0] as TreeSpeciesGeometryMap;
    speciesMap.variants = variants;
    out[species] = speciesMap;
  }
  return out;
}

export function disposeTreeGeometryMap(map: TreeGeometryMap): void {
  for (const species of TREE_SPECIES) {
    const variants = map[species].variants ?? { 0: map[species] };
    for (const variant of Object.values(variants)) {
      for (const lod of TREE_LODS) variant[lod].dispose();
    }
  }
}

/**
 * Stable signature of every setting that `createTreeGeometry` consumes. Compare
 * two keys to decide whether tree geometry must be rebuilt, instead of a fragile
 * `settings.species` object-reference compare.
 */
export function treeGeometryKey(settings: TreeSettings): string {
  return JSON.stringify({
    seed: settings.seed,
    variants: TREE_STRUCTURAL_VARIANTS,
    budgets: settings.lod.budgets,
    species: TREE_SPECIES.map((species) => {
      const config = settings.species[species];
      return [config.trunkHeightM, config.trunkRadiusM, config.crownRadiusM];
    }),
  });
}

export function createTreeBakedImpostorGeometry(
  species: TreeSpeciesId,
  settings: TreeSettings,
): THREE.BufferGeometry {
  const config = settings.species[species];
  const builder = new GeometryBuilder();
  const height = species === "pine"
    ? config.trunkHeightM + config.crownRadiusM * 2.85 * config.morphology.crownFlattening
    : species === "oak"
      ? config.trunkHeightM + config.crownRadiusM * 1.7 / Math.max(0.55, config.morphology.crownFlattening)
      : config.trunkHeightM * 1.08;
  const width = species === "pine"
    ? config.crownRadiusM * 1.9
    : species === "oak"
      ? config.crownRadiusM * 3.0
      : Math.max(config.trunkRadiusM * 4, config.morphology.branchLength * 1.6);
  builder.addFlatCard(
    new THREE.Vector3(0, height * 0.5, 0),
    Math.max(0.25, width),
    Math.max(0.5, height),
    0,
    0,
    new THREE.Color(0xffffff),
    0.08,
    0,
    unitFrame(),
    1,
  );
  const geometry = builder.build();
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
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

/** discrete grammar LOD for each non-impostor tree LOD */
const GRAMMAR_LOD: Record<Exclude<TreeLod, "impostor">, VegLod> = { near: 0, mid: 1, far: 2 };

/**
 * Visual height the procedural grammar tree is scaled to, so placement, LOD
 * distance bands and per-instance age scaling keep matching the configured
 * per-species dimensions (mirrors the old far-silhouette / impostor sizing).
 */
function targetTreeHeight(species: TreeSpeciesId, config: TreeSettings["species"][TreeSpeciesId]): number {
  if (species === "pine") return config.trunkHeightM + config.crownRadiusM * 2.85;
  if (species === "oak") return config.trunkHeightM + config.crownRadiusM * 1.7;
  return config.trunkHeightM * 1.08; // dead snag (no crown)
}

function createTreeGeometry(
  species: TreeSpeciesId,
  variant: number,
  lod: TreeLod,
  settings: TreeSettings,
): THREE.BufferGeometry {
  const config = settings.species[species];

  if (lod === "impostor") {
    const builder = new GeometryBuilder();
    appendImpostorTree(builder, species, config, settings);
    const geometry = builder.build();
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
  }

  // All LODs for the same species+variant derive from the same skeleton seed;
  // only bark/foliage budgets vary by LOD.
  const sp = VEG_TREE_SPECIES[species];
  const rng = vegRng(settings.seed, `tree/${species}/${variant}`);
  const built = buildTree(sp, rng, { lod: GRAMMAR_LOD[lod], barkColor: VEG_BARK_COLOR[species] });
  const geometry = built.geometry;
  const target = targetTreeHeight(species, config);
  if (built.stats.height > 1e-3 && target > 1e-3) {
    const s = target / built.stats.height;
    geometry.scale(s, s, s);
  }
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
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

function appendImpostorTree(
  builder: GeometryBuilder,
  species: TreeSpeciesId,
  config: TreeSettings["species"][TreeSpeciesId],
  settings: TreeSettings,
): void {
  const bark = species === "dead" ? DEAD_BARK : BARK;
  const trunkWidth = Math.max(0.18, config.trunkRadiusM * (species === "dead" ? 2.4 : 1.7));
  for (const rotation of [0, Math.PI * 0.5]) {
    builder.addFlatCard(
      new THREE.Vector3(0, config.trunkHeightM * 0.5, 0),
      trunkWidth,
      config.trunkHeightM,
      rotation,
      0,
      bark,
      species === "dead" ? 0.22 : 0.38,
      0,
      centeredFrame(),
      0,
    );
  }

  if (species === "dead") {
    appendDeadImpostorBranches(builder, config);
    return;
  }

  const leafColor = species === "pine"
    ? PINE_LEAF_LOW.clone().lerp(PINE_LEAF_HIGH, 0.35)
    : OAK_LEAF_LOW.clone().lerp(OAK_LEAF_HIGH, 0.45);
  const crownWidth = species === "pine" ? config.crownRadiusM * 1.75 : config.crownRadiusM * 2.75;
  const crownHeight = species === "pine"
    ? config.crownRadiusM * 2.85 * config.morphology.crownFlattening
    : config.crownRadiusM * 1.55 / Math.max(0.55, config.morphology.crownFlattening);
  const centerY = species === "pine" ? config.trunkHeightM + crownHeight * 0.42 : config.trunkHeightM + crownHeight * 0.54;
  const rotations = species === "pine" ? [0, Math.PI * 0.5] : [0, Math.PI / 3, Math.PI * 2 / 3];
  for (let i = 0; i < rotations.length; i++) {
    builder.addFlatCard(
      new THREE.Vector3(0, centerY, 0),
      crownWidth,
      crownHeight,
      rotations[i],
      species === "pine" ? -0.06 : 0.03,
      leafColor,
      0.72,
      species === "pine" ? 0.12 : 0.18,
      atlasFrame(foliageAtlasCell(species, i, settings), settings),
      1,
    );
  }
}

function appendDeadImpostorBranches(
  builder: GeometryBuilder,
  config: TreeSettings["species"][TreeSpeciesId],
): void {
  const branches: readonly [THREE.Vector3, THREE.Vector3, number][] = [
    [
      new THREE.Vector3(0, config.trunkHeightM * 0.62, 0),
      new THREE.Vector3(config.morphology.branchLength * 0.7, config.trunkHeightM * 0.82, 0.18),
      0.09,
    ],
    [
      new THREE.Vector3(0, config.trunkHeightM * 0.72, 0),
      new THREE.Vector3(-config.morphology.branchLength * 0.58, config.trunkHeightM * 0.88, -0.16),
      0.075,
    ],
    [
      new THREE.Vector3(0, config.trunkHeightM * 0.82, 0),
      new THREE.Vector3(config.morphology.branchLength * 0.36, config.trunkHeightM * 1.04, -0.1),
      0.06,
    ],
  ];
  for (const [start, end, width] of branches) {
    builder.addBranchCard(start, end, width, DEAD_BARK, 0.24, 0.02);
  }
}

class GeometryBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly colors: number[] = [];
  private readonly uvs: number[] = [];
  private readonly windWeights: number[] = [];
  private readonly flutterWeights: number[] = [];
  private readonly foliageMasks: number[] = [];
  private readonly indices: number[] = [];

  addVertex(
    position: THREE.Vector3,
    normal: THREE.Vector3,
    color: THREE.Color,
    windWeight: number,
    flutterWeight: number,
    uv: readonly [number, number] = [0.5, 0.5],
    foliageMask = 0,
  ): number {
    this.positions.push(position.x, position.y, position.z);
    this.normals.push(normal.x, normal.y, normal.z);
    this.colors.push(color.r, color.g, color.b);
    this.uvs.push(uv[0], uv[1]);
    this.windWeights.push(clamp01(windWeight));
    this.flutterWeights.push(clamp01(flutterWeight));
    this.foliageMasks.push(clamp01(foliageMask));
    return this.positions.length / 3 - 1;
  }

  addQuad(a: number, b: number, c: number, d: number): void {
    this.indices.push(a, b, c, a, c, d);
  }

  addFlatCard(
    center: THREE.Vector3,
    width: number,
    height: number,
    rotationY: number,
    tilt: number,
    color: THREE.Color,
    windWeight: number,
    flutterWeight: number,
    frame: AtlasFrame,
    foliageMask: number,
  ): void {
    const right = new THREE.Vector3(Math.cos(rotationY), 0, -Math.sin(rotationY));
    const up = new THREE.Vector3(
      Math.sin(rotationY) * Math.sin(tilt),
      Math.cos(tilt),
      Math.cos(rotationY) * Math.sin(tilt),
    ).normalize();
    const normal = new THREE.Vector3().crossVectors(right, up).normalize();
    const halfWidth = width * 0.5;
    const halfHeight = height * 0.5;
    const p0 = center.clone().addScaledVector(right, -halfWidth).addScaledVector(up, -halfHeight);
    const p1 = center.clone().addScaledVector(right, halfWidth).addScaledVector(up, -halfHeight);
    const p2 = center.clone().addScaledVector(right, halfWidth).addScaledVector(up, halfHeight);
    const p3 = center.clone().addScaledVector(right, -halfWidth).addScaledVector(up, halfHeight);
    const a = this.addVertex(p0, normal, color, windWeight, flutterWeight, [frame.u0, frame.v1], foliageMask);
    const b = this.addVertex(p1, normal, color, windWeight, flutterWeight, [frame.u1, frame.v1], foliageMask);
    const c = this.addVertex(p2, normal, color, windWeight, flutterWeight, [frame.u1, frame.v0], foliageMask);
    const d = this.addVertex(p3, normal, color, windWeight, flutterWeight, [frame.u0, frame.v0], foliageMask);
    this.addQuad(a, b, c, d);
  }

  addBranchCard(
    start: THREE.Vector3,
    end: THREE.Vector3,
    width: number,
    color: THREE.Color,
    windWeight: number,
    flutterWeight: number,
  ): void {
    const axis = end.clone().sub(start);
    if (axis.lengthSq() <= 1e-8) return;
    const right = new THREE.Vector3(axis.z, 0, -axis.x);
    if (right.lengthSq() <= 1e-8) right.set(1, 0, 0);
    right.normalize().multiplyScalar(width * 0.5);
    const normal = new THREE.Vector3().crossVectors(right, axis).normalize();
    const a = this.addVertex(start.clone().sub(right), normal, color, windWeight, flutterWeight);
    const b = this.addVertex(start.clone().add(right), normal, color, windWeight, flutterWeight);
    const c = this.addVertex(end.clone().add(right), normal, color, windWeight, flutterWeight);
    const d = this.addVertex(end.clone().sub(right), normal, color, windWeight, flutterWeight);
    this.addQuad(a, b, c, d);
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(this.uvs, 2));
    const treeWind = new Float32Array(this.windWeights.length * 2);
    for (let i = 0; i < this.windWeights.length; i++) {
      treeWind[i * 2] = this.windWeights[i];
      treeWind[i * 2 + 1] = this.flutterWeights[i];
    }
    geometry.setAttribute("treeWind", new THREE.Float32BufferAttribute(treeWind, 2));
    geometry.setAttribute("treeFoliageMask", new THREE.Float32BufferAttribute(this.foliageMasks, 1));
    geometry.setIndex(this.indices);
    return geometry;
  }
}

interface AtlasFrame {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

function atlasFrame(cell: number, settings: TreeSettings): AtlasFrame {
  const columns = settings.foliage.textureAtlasColumns;
  const rows = settings.foliage.textureAtlasRows;
  const cellCount = columns * rows;
  const safeCell = Math.max(0, Math.min(cellCount - 1, cell));
  const x = safeCell % columns;
  const y = Math.floor(safeCell / columns);
  const insetU = 0.5 / (columns * settings.foliage.maskResolutionPx);
  const insetV = 0.5 / (rows * settings.foliage.maskResolutionPx);
  return {
    u0: x / columns + insetU,
    u1: (x + 1) / columns - insetU,
    v0: y / rows + insetV,
    v1: (y + 1) / rows - insetV,
  };
}

function centeredFrame(): AtlasFrame {
  return {
    u0: 0.5,
    u1: 0.5,
    v0: 0.5,
    v1: 0.5,
  };
}

function unitFrame(): AtlasFrame {
  return {
    u0: 0,
    u1: 1,
    v0: 0,
    v1: 1,
  };
}

function maxAttributeValue(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined): number {
  if (!attribute) return 0;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < attribute.count; i++) max = Math.max(max, attribute.getX(i));
  return max;
}

function maxAttributeComponent(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined,
  axis: "x" | "y",
): number {
  if (!attribute) return 0;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < attribute.count; i++) {
    max = Math.max(max, axis === "x" ? attribute.getX(i) : attribute.getY(i));
  }
  return max;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
