import * as THREE from "three";
import { UNDERSTORY_CLASSES, type UnderstoryClass, type UnderstorySettings } from "./understory_config.js";

export type UnderstoryGeometryMap = Record<UnderstoryClass, THREE.BufferGeometry>;

const GREEN_DARK = new THREE.Color(0x2f5f35);
const GREEN_LIGHT = new THREE.Color(0x6f9f49);
const FERN_GREEN = new THREE.Color(0x3c7a3f);
const FLOWER_STEM = new THREE.Color(0x3d6c35);
const FLOWER_PINK = new THREE.Color(0xdb7fa7);
const BARK = new THREE.Color(0x6a4932);
const BARK_DARK = new THREE.Color(0x3f2a1e);
const DEAD_WOOD = new THREE.Color(0x80694e);

export function createUnderstoryGeometryMap(settings: UnderstorySettings): UnderstoryGeometryMap {
  const map = {} as UnderstoryGeometryMap;
  for (const cls of UNDERSTORY_CLASSES) map[cls] = createUnderstoryGeometry(cls, settings);
  return map;
}

export function disposeUnderstoryGeometryMap(map: UnderstoryGeometryMap): void {
  for (const geometry of Object.values(map)) geometry.dispose();
}

export function createUnderstoryGeometry(cls: UnderstoryClass, settings: UnderstorySettings): THREE.BufferGeometry {
  const builder = new GeometryBuilder();
  if (cls === "shrub") appendShrub(builder, settings.classes.shrub.windWeight);
  else if (cls === "fern") appendFern(builder, settings.classes.fern.windWeight);
  else if (cls === "sapling") appendSapling(builder, settings.classes.sapling.windWeight);
  else if (cls === "flower") appendFlower(builder, settings.classes.flower.windWeight);
  else if (cls === "dead_log") appendDeadLog(builder);
  else appendStump(builder);
  const geometry = builder.build();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function understoryGeometrySummary(geometry: THREE.BufferGeometry): {
  vertexCount: number;
  indexCount: number;
  colorCount: number;
  maxWindWeight: number;
} {
  return {
    vertexCount: geometry.getAttribute("position")?.count ?? 0,
    indexCount: geometry.getIndex()?.count ?? 0,
    colorCount: geometry.getAttribute("color")?.count ?? 0,
    maxWindWeight: maxAttributeValue(geometry.getAttribute("understoryWindWeight")),
  };
}

function appendShrub(builder: GeometryBuilder, wind: number): void {
  for (let i = 0; i < 5; i++) {
    const angle = i * Math.PI / 5;
    const width = 1.0 + (i % 2) * 0.28;
    const height = 0.78 + (i % 3) * 0.14;
    const y = height * 0.46;
    const color = GREEN_DARK.clone().lerp(GREEN_LIGHT, 0.25 + i * 0.08);
    builder.addCard(new THREE.Vector3(0, y, 0), width, height, angle, 0.05, color, wind, 1);
  }
}

function appendFern(builder: GeometryBuilder, wind: number): void {
  for (let i = 0; i < 7; i++) {
    const angle = i / 7 * Math.PI * 2;
    const length = 1.0 + (i % 3) * 0.12;
    const center = new THREE.Vector3(Math.sin(angle) * length * 0.28, 0.24, Math.cos(angle) * length * 0.28);
    builder.addTaperedCard(center, 0.22, length, angle, -0.65, FERN_GREEN.clone().lerp(GREEN_LIGHT, i / 12), wind, 1);
  }
}

function appendSapling(builder: GeometryBuilder, wind: number): void {
  builder.addCylinder(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1.1, 0), 0.055, 0.028, 6, BARK, wind * 0.35);
  for (let i = 0; i < 5; i++) {
    const angle = i / 5 * Math.PI * 2;
    const y = 0.62 + i * 0.1;
    builder.addCard(new THREE.Vector3(0, y, 0), 0.62, 0.42, angle, 0.18, GREEN_DARK.clone().lerp(GREEN_LIGHT, i / 5), wind, 1);
  }
}

function appendFlower(builder: GeometryBuilder, wind: number): void {
  builder.addCylinder(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.48, 0), 0.014, 0.01, 4, FLOWER_STEM, wind);
  for (let i = 0; i < 2; i++) {
    builder.addCard(new THREE.Vector3(0, 0.54, 0), 0.24, 0.2, i * Math.PI * 0.5, 0, FLOWER_PINK.clone().lerp(new THREE.Color(0xffe06b), i * 0.35), wind, 1);
  }
}

function appendDeadLog(builder: GeometryBuilder): void {
  builder.addCylinder(new THREE.Vector3(-0.72, 0.18, 0), new THREE.Vector3(0.72, 0.18, 0), 0.18, 0.16, 8, DEAD_WOOD, 0);
  builder.addCylinder(new THREE.Vector3(-0.64, 0.32, 0.04), new THREE.Vector3(-0.32, 0.44, 0.12), 0.04, 0.02, 5, BARK_DARK, 0);
}

function appendStump(builder: GeometryBuilder): void {
  builder.addCylinder(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.42, 0), 0.18, 0.15, 9, BARK, 0);
  builder.addDisk(new THREE.Vector3(0, 0.43, 0), 0.15, 9, DEAD_WOOD);
}

class GeometryBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly colors: number[] = [];
  private readonly uvs: number[] = [];
  private readonly windWeights: number[] = [];
  private readonly classMasks: number[] = [];
  private readonly indices: number[] = [];

  addVertex(
    position: THREE.Vector3,
    normal: THREE.Vector3,
    color: THREE.Color,
    windWeight: number,
    uv: readonly [number, number] = [0.5, 0.5],
    classMask = 0,
  ): number {
    this.positions.push(position.x, position.y, position.z);
    this.normals.push(normal.x, normal.y, normal.z);
    this.colors.push(color.r, color.g, color.b);
    this.uvs.push(uv[0], uv[1]);
    this.windWeights.push(clamp01(windWeight));
    this.classMasks.push(classMask);
    return this.positions.length / 3 - 1;
  }

  addQuad(a: number, b: number, c: number, d: number): void {
    this.indices.push(a, b, c, a, c, d);
  }

  addCard(
    center: THREE.Vector3,
    width: number,
    height: number,
    rotationY: number,
    tilt: number,
    color: THREE.Color,
    windWeight: number,
    classMask: number,
  ): void {
    const right = new THREE.Vector3(Math.cos(rotationY), 0, -Math.sin(rotationY));
    const up = new THREE.Vector3(
      Math.sin(rotationY) * Math.sin(tilt),
      Math.cos(tilt),
      Math.cos(rotationY) * Math.sin(tilt),
    ).normalize();
    const normal = new THREE.Vector3().crossVectors(right, up).normalize();
    const hw = width * 0.5;
    const hh = height * 0.5;
    const a = this.addVertex(center.clone().addScaledVector(right, -hw).addScaledVector(up, -hh), normal, color, windWeight, [0, 1], classMask);
    const b = this.addVertex(center.clone().addScaledVector(right, hw).addScaledVector(up, -hh), normal, color, windWeight, [1, 1], classMask);
    const c = this.addVertex(center.clone().addScaledVector(right, hw).addScaledVector(up, hh), normal, color, windWeight, [1, 0], classMask);
    const d = this.addVertex(center.clone().addScaledVector(right, -hw).addScaledVector(up, hh), normal, color, windWeight, [0, 0], classMask);
    this.addQuad(a, b, c, d);
  }

  addTaperedCard(
    center: THREE.Vector3,
    width: number,
    height: number,
    rotationY: number,
    tilt: number,
    color: THREE.Color,
    windWeight: number,
    classMask: number,
  ): void {
    const right = new THREE.Vector3(Math.cos(rotationY), 0, -Math.sin(rotationY));
    const forward = new THREE.Vector3(Math.sin(rotationY), 0, Math.cos(rotationY));
    const up = new THREE.Vector3(0, Math.cos(tilt), Math.sin(tilt)).normalize();
    const normal = new THREE.Vector3().crossVectors(right, up).normalize();
    const root = center.clone().addScaledVector(forward, -height * 0.35);
    const tip = center.clone().addScaledVector(forward, height * 0.45).add(new THREE.Vector3(0, 0.2, 0));
    const a = this.addVertex(root.clone().addScaledVector(right, -width), normal, color, windWeight * 0.6, [0, 1], classMask);
    const b = this.addVertex(root.clone().addScaledVector(right, width), normal, color, windWeight * 0.6, [1, 1], classMask);
    const c = this.addVertex(tip, normal, color.clone().lerp(GREEN_LIGHT, 0.2), windWeight, [0.5, 0], classMask);
    this.indices.push(a, b, c);
  }

  addCylinder(
    start: THREE.Vector3,
    end: THREE.Vector3,
    radiusStart: number,
    radiusEnd: number,
    radialSegments: number,
    color: THREE.Color,
    windWeight: number,
  ): void {
    const axis = end.clone().sub(start);
    if (axis.lengthSq() <= 1e-8) return;
    axis.normalize();
    const reference = Math.abs(axis.y) > 0.92 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const tangent = new THREE.Vector3().crossVectors(axis, reference).normalize();
    const bitangent = new THREE.Vector3().crossVectors(axis, tangent).normalize();
    const lower: number[] = [];
    const upper: number[] = [];
    for (let i = 0; i < radialSegments; i++) {
      const angle = i / radialSegments * Math.PI * 2;
      const normal = tangent.clone().multiplyScalar(Math.cos(angle)).addScaledVector(bitangent, Math.sin(angle)).normalize();
      lower.push(this.addVertex(start.clone().addScaledVector(normal, radiusStart), normal, color, windWeight));
      upper.push(this.addVertex(end.clone().addScaledVector(normal, radiusEnd), normal, color, windWeight));
    }
    for (let i = 0; i < radialSegments; i++) {
      this.addQuad(lower[i], lower[(i + 1) % radialSegments], upper[(i + 1) % radialSegments], upper[i]);
    }
  }

  addDisk(center: THREE.Vector3, radius: number, segments: number, color: THREE.Color): void {
    const normal = new THREE.Vector3(0, 1, 0);
    const mid = this.addVertex(center, normal, color, 0);
    const ring: number[] = [];
    for (let i = 0; i < segments; i++) {
      const angle = i / segments * Math.PI * 2;
      ring.push(this.addVertex(new THREE.Vector3(center.x + Math.cos(angle) * radius, center.y, center.z + Math.sin(angle) * radius), normal, color, 0));
    }
    for (let i = 0; i < segments; i++) this.indices.push(mid, ring[i], ring[(i + 1) % segments]);
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.setAttribute("understoryWindWeight", new THREE.Float32BufferAttribute(this.windWeights, 1));
    geometry.setAttribute("understoryClassMask", new THREE.Float32BufferAttribute(this.classMasks, 1));
    geometry.setIndex(this.indices);
    return geometry;
  }
}

function maxAttributeValue(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined): number {
  if (!attribute) return 0;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < attribute.count; i++) max = Math.max(max, attribute.getX(i));
  return max;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
