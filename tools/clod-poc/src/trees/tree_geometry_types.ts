import * as THREE from "three";
import type { TreeLod, TreeSettings, TreeSpeciesId } from "./tree_config.js";
import type { VegLod } from "../veg/veg_tree_builder.js";
import { VEG_BARK_COLOR } from "../veg/veg_species.js";

export type TreeVariantGeometryMap = Record<number, Record<TreeLod, THREE.BufferGeometry>>;
export type TreeSpeciesGeometryMap = Record<TreeLod, THREE.BufferGeometry> & { variants: TreeVariantGeometryMap };
export type TreeGeometryMap = Record<TreeSpeciesId, TreeSpeciesGeometryMap>;

export const OAK_LEAF_LOW = new THREE.Color(0x2c6f36);
export const OAK_LEAF_HIGH = new THREE.Color(0x4f9a42);
export const PINE_LEAF_LOW = new THREE.Color(0x1d4e32);
export const PINE_LEAF_HIGH = new THREE.Color(0x367142);
export const DEAD_BARK = new THREE.Color(0x7a6653);

export const GRAMMAR_LOD: Record<Exclude<TreeLod, "impostor">, VegLod> = { near: 0, mid: 1, far: 2 };
export const TREE_LOD_VERTEX_BUDGET: Record<TreeLod, keyof TreeSettings["lod"]["budgets"]> = {
  near: "nearMaxVertices",
  mid: "midMaxVertices",
  far: "farMaxVertices",
  impostor: "impostorMaxVertices",
};

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function maxAttributeValue(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined): number {
  if (!attribute) return 0;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < attribute.count; i++) max = Math.max(max, attribute.getX(i));
  return max === Number.NEGATIVE_INFINITY ? 0 : max;
}

export function maxAttributeComponent(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined,
  component: "x" | "y" | "z",
): number {
  if (!attribute) return 0;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < attribute.count; i++) {
    const value = component === "x"
      ? attribute.getX(i)
      : component === "y"
        ? attribute.getY(i)
        : attribute.getZ(i);
    max = Math.max(max, value);
  }
  return max === Number.NEGATIVE_INFINITY ? 0 : max;
}

export interface AtlasFrame {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

export function unitFrame(): AtlasFrame {
  return { u0: 0, u1: 1, v0: 0, v1: 1 };
}

export function targetTreeHeight(species: TreeSpeciesId, config: TreeSettings["species"][TreeSpeciesId]): number {
  if (species === "pine") return config.trunkHeightM + config.crownRadiusM * 2.85;
  if (species === "oak") return config.trunkHeightM + config.crownRadiusM * 1.7;
  return config.trunkHeightM * 1.08;
}

export function appendAttribute(
  geometry: THREE.BufferGeometry,
  name: string,
  itemSize: number,
  target: number[],
  vertexCount: number,
): void {
  const attribute = geometry.getAttribute(name);
  if (!attribute) {
    for (let i = 0; i < vertexCount * itemSize; i++) target.push(0);
    return;
  }
  const array = attribute.array;
  for (let i = 0; i < vertexCount * itemSize; i++) target.push(Number(array[i]));
}

export function setTreeVariantAttribute(geometry: THREE.BufferGeometry, variant: number): void {
  const vertexCount = geometry.getAttribute("position")?.count ?? 0;
  geometry.setAttribute("treeVariant", new THREE.Float32BufferAttribute(new Float32Array(vertexCount).fill(variant), 1));
}

export function disposeGeometryOnce(geometry: THREE.BufferGeometry, disposed: Set<THREE.BufferGeometry>): void {
  if (disposed.has(geometry)) return;
  disposed.add(geometry);
  geometry.dispose();
}

export function createOpaqueImpostorTree(
  species: TreeSpeciesId,
  config: TreeSettings["species"][TreeSpeciesId],
): THREE.BufferGeometry {
  const builder = new GeometryBuilder();
  const bark = species === "dead" ? DEAD_BARK : VEG_BARK_COLOR[species];
  const trunkHeight = Math.max(0.35, config.trunkHeightM);
  const trunkWidth = Math.max(0.12, config.trunkRadiusM * 2.0);
  builder.addBox(
    new THREE.Vector3(0, trunkHeight * 0.5, 0),
    new THREE.Vector3(trunkWidth, trunkHeight, trunkWidth),
    bark,
    species === "dead" ? 0.18 : 0.32,
    0,
    0,
  );

  if (species !== "dead" && config.crownRadiusM > 0.01) {
    const leafColor = species === "pine"
      ? PINE_LEAF_LOW.clone().lerp(PINE_LEAF_HIGH, 0.35)
      : OAK_LEAF_LOW.clone().lerp(OAK_LEAF_HIGH, 0.45);
    const crownY = species === "pine"
      ? trunkHeight + config.crownRadiusM * 1.15
      : trunkHeight + config.crownRadiusM * 0.78;
    const crownRadius = Math.max(0.3, config.crownRadiusM * (species === "pine" ? 0.74 : 0.95));
    const crownHeight = Math.max(0.6, config.crownRadiusM * (species === "pine" ? 2.2 : 1.2));
    builder.addOctahedron(
      new THREE.Vector3(0, crownY, 0),
      new THREE.Vector3(crownRadius, crownHeight * 0.5, crownRadius),
      leafColor,
      0.64,
      species === "pine" ? 0.15 : 0.24,
      1,
    );
  }

  const geometry = builder.build();
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

export class GeometryBuilder {
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

  addTriangle(
    p0: THREE.Vector3,
    p1: THREE.Vector3,
    p2: THREE.Vector3,
    color: THREE.Color,
    windWeight: number,
    flutterWeight: number,
    foliageMask: number,
  ): void {
    const normal = new THREE.Vector3().crossVectors(
      p1.clone().sub(p0),
      p2.clone().sub(p0),
    ).normalize();
    const a = this.addVertex(p0, normal, color, windWeight, flutterWeight, [0.5, 0.5], foliageMask);
    const b = this.addVertex(p1, normal, color, windWeight, flutterWeight, [0.5, 0.5], foliageMask);
    const c = this.addVertex(p2, normal, color, windWeight, flutterWeight, [0.5, 0.5], foliageMask);
    this.indices.push(a, b, c);
  }

  addQuad(a: number, b: number, c: number, d: number): void {
    this.indices.push(a, b, c, a, c, d);
  }

  addBox(
    center: THREE.Vector3,
    size: THREE.Vector3,
    color: THREE.Color,
    windWeight: number,
    flutterWeight: number,
    foliageMask: number,
  ): void {
    const hx = size.x * 0.5;
    const hy = size.y * 0.5;
    const hz = size.z * 0.5;
    const p = [
      new THREE.Vector3(center.x - hx, center.y - hy, center.z - hz),
      new THREE.Vector3(center.x + hx, center.y - hy, center.z - hz),
      new THREE.Vector3(center.x + hx, center.y + hy, center.z - hz),
      new THREE.Vector3(center.x - hx, center.y + hy, center.z - hz),
      new THREE.Vector3(center.x - hx, center.y - hy, center.z + hz),
      new THREE.Vector3(center.x + hx, center.y - hy, center.z + hz),
      new THREE.Vector3(center.x + hx, center.y + hy, center.z + hz),
      new THREE.Vector3(center.x - hx, center.y + hy, center.z + hz),
    ];
    const faces: readonly [number, number, number, number][] = [
      [0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7],
      [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0],
    ];
    for (const [a, b, c, d] of faces) {
      this.addTriangle(p[a], p[b], p[c], color, windWeight, flutterWeight, foliageMask);
      this.addTriangle(p[a], p[c], p[d], color, windWeight, flutterWeight, foliageMask);
    }
  }

  addOctahedron(
    center: THREE.Vector3,
    radius: THREE.Vector3,
    color: THREE.Color,
    windWeight: number,
    flutterWeight: number,
    foliageMask: number,
  ): void {
    const top = center.clone().add(new THREE.Vector3(0, radius.y, 0));
    const bottom = center.clone().add(new THREE.Vector3(0, -radius.y, 0));
    const east = center.clone().add(new THREE.Vector3(radius.x, 0, 0));
    const west = center.clone().add(new THREE.Vector3(-radius.x, 0, 0));
    const north = center.clone().add(new THREE.Vector3(0, 0, -radius.z));
    const south = center.clone().add(new THREE.Vector3(0, 0, radius.z));
    for (const [a, b] of [[north, east], [east, south], [south, west], [west, north]] as const) {
      this.addTriangle(top, a, b, color, windWeight, flutterWeight, foliageMask);
      this.addTriangle(bottom, b, a, color, windWeight * 0.6, flutterWeight, foliageMask);
    }
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
    const uv0: [number, number] = [frame.u0, frame.v0];
    const uv1: [number, number] = [frame.u1, frame.v0];
    const uv2: [number, number] = [frame.u1, frame.v1];
    const uv3: [number, number] = [frame.u0, frame.v1];
    const base = this.addVertex(p0, normal, color, windWeight, flutterWeight, uv0, foliageMask);
    this.addVertex(p1, normal, color, windWeight, flutterWeight, uv1, foliageMask);
    this.addVertex(p2, normal, color, windWeight, flutterWeight, uv2, foliageMask);
    this.addVertex(p3, normal, color, windWeight, flutterWeight, uv3, foliageMask);
    this.addQuad(base, base + 1, base + 2, base + 3);
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(this.uvs, 2));
    const wind = new Float32Array(this.windWeights.length * 2);
    for (let i = 0; i < this.windWeights.length; i++) {
      wind[i * 2] = this.windWeights[i] as number;
      wind[i * 2 + 1] = this.flutterWeights[i] as number;
    }
    geometry.setAttribute("treeWind", new THREE.Float32BufferAttribute(wind, 2));
    geometry.setAttribute("treeFoliageMask", new THREE.Float32BufferAttribute(this.foliageMasks, 1));
    geometry.setIndex(this.indices);
    return geometry;
  }
}
