import * as THREE from "three";
import { TREE_LODS, TREE_SPECIES, type TreeLod, type TreeSettings, type TreeSpeciesId } from "./tree_config.js";

export type TreeGeometryMap = Record<TreeSpeciesId, Record<TreeLod, THREE.BufferGeometry>>;

const BARK = new THREE.Color(0x5b3a22);
const DEAD_BARK = new THREE.Color(0x7a6653);
const OAK_LEAF = new THREE.Color(0x2f7d3d);
const PINE_LEAF = new THREE.Color(0x1f5b35);

export function createTreeGeometryMap(settings: TreeSettings): TreeGeometryMap {
  const out = {} as TreeGeometryMap;
  for (const species of TREE_SPECIES) {
    out[species] = {} as Record<TreeLod, THREE.BufferGeometry>;
    for (const lod of TREE_LODS) {
      out[species][lod] = createTreeGeometry(species, lod, settings);
    }
  }
  return out;
}

export function disposeTreeGeometryMap(map: TreeGeometryMap): void {
  for (const species of TREE_SPECIES) {
    for (const lod of TREE_LODS) map[species][lod].dispose();
  }
}

function createTreeGeometry(species: TreeSpeciesId, lod: TreeLod, settings: TreeSettings): THREE.BufferGeometry {
  const config = settings.species[species];
  const builder = new GeometryBuilder();
  const trunkSegments = lod === "near" ? 7 : lod === "mid" ? 5 : 3;
  const trunkHeight = config.trunkHeightM;
  const trunkRadius = config.trunkRadiusM;
  builder.append(
    new THREE.CylinderGeometry(trunkRadius * 0.72, trunkRadius, trunkHeight, trunkSegments, 1),
    new THREE.Matrix4().makeTranslation(0, trunkHeight * 0.5, 0),
    species === "dead" ? DEAD_BARK : BARK,
  );

  if (species === "oak") appendOakCrown(builder, lod, trunkHeight, config.crownRadiusM);
  else if (species === "pine") appendPineCrown(builder, lod, trunkHeight, config.crownRadiusM);
  else appendDeadBranches(builder, lod, trunkHeight, trunkRadius);

  const geometry = builder.build();
  geometry.computeBoundingSphere();
  return geometry;
}

function appendOakCrown(builder: GeometryBuilder, lod: TreeLod, trunkHeight: number, radius: number): void {
  if (lod === "far") {
    appendCrossCards(builder, trunkHeight + radius * 0.45, radius * 1.55, radius * 1.75, OAK_LEAF);
    return;
  }
  const clusters = lod === "near"
    ? [
        [0, trunkHeight + radius * 0.85, 0, radius],
        [-radius * 0.38, trunkHeight + radius * 0.55, 0.14, radius * 0.72],
        [radius * 0.34, trunkHeight + radius * 0.48, -0.22, radius * 0.68],
      ]
    : [[0, trunkHeight + radius * 0.62, 0, radius * 0.95]];
  for (const [x, y, z, r] of clusters) {
    const sphere = new THREE.SphereGeometry(r, lod === "near" ? 7 : 5, lod === "near" ? 5 : 4);
    builder.append(sphere, new THREE.Matrix4().makeTranslation(x, y, z), OAK_LEAF);
  }
}

function appendPineCrown(builder: GeometryBuilder, lod: TreeLod, trunkHeight: number, radius: number): void {
  if (lod === "far") {
    appendCrossCards(builder, trunkHeight + radius * 0.55, radius * 1.25, radius * 2.2, PINE_LEAF);
    return;
  }
  const cone = new THREE.ConeGeometry(radius, radius * (lod === "near" ? 2.6 : 2.1), lod === "near" ? 7 : 5, 1);
  builder.append(cone, new THREE.Matrix4().makeTranslation(0, trunkHeight + radius, 0), PINE_LEAF);
  if (lod === "near") {
    const lower = new THREE.ConeGeometry(radius * 1.12, radius * 1.6, 7, 1);
    builder.append(lower, new THREE.Matrix4().makeTranslation(0, trunkHeight + radius * 0.25, 0), PINE_LEAF);
  }
}

function appendDeadBranches(builder: GeometryBuilder, lod: TreeLod, trunkHeight: number, trunkRadius: number): void {
  if (lod === "far") return;
  const branchCount = lod === "near" ? 2 : 1;
  for (let i = 0; i < branchCount; i++) {
    const branch = new THREE.CylinderGeometry(trunkRadius * 0.18, trunkRadius * 0.28, trunkHeight * 0.42, 4, 1);
    const matrix = new THREE.Matrix4()
      .makeRotationZ(i === 0 ? -0.88 : 0.72)
      .premultiply(new THREE.Matrix4().makeRotationY(i === 0 ? 0.35 : -0.8))
      .setPosition(i === 0 ? trunkRadius * 1.2 : -trunkRadius, trunkHeight * (0.62 + i * 0.12), i === 0 ? 0 : trunkRadius * 0.7);
    builder.append(branch, matrix, DEAD_BARK);
  }
}

function appendCrossCards(
  builder: GeometryBuilder,
  centerY: number,
  width: number,
  height: number,
  color: THREE.Color,
): void {
  for (const rotation of [0, Math.PI * 0.5]) {
    const plane = new THREE.PlaneGeometry(width, height, 1, 1);
    const matrix = new THREE.Matrix4()
      .makeRotationY(rotation)
      .premultiply(new THREE.Matrix4().makeTranslation(0, centerY, 0));
    builder.append(plane, matrix, color);
  }
}

class GeometryBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly colors: number[] = [];
  private readonly indices: number[] = [];

  append(source: THREE.BufferGeometry, matrix: THREE.Matrix4, color: THREE.Color): void {
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
    const position = source.getAttribute("position");
    const normal = source.getAttribute("normal");
    const index = source.getIndex();
    const base = this.positions.length / 3;
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      p.fromBufferAttribute(position, i).applyMatrix4(matrix);
      this.positions.push(p.x, p.y, p.z);
      if (normal) n.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize();
      else n.set(0, 1, 0);
      this.normals.push(n.x, n.y, n.z);
      this.colors.push(color.r, color.g, color.b);
    }
    if (index) {
      for (let i = 0; i < index.count; i++) this.indices.push(base + index.getX(i));
    } else {
      for (let i = 0; i < position.count; i++) this.indices.push(base + i);
    }
    source.dispose();
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setIndex(this.indices);
    return geometry;
  }
}
