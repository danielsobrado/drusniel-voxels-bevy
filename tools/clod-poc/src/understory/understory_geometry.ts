import * as THREE from "three";
import { UNDERSTORY_CLASSES, type UnderstoryClass, type UnderstorySettings } from "./understory_config.js";
import { understoryHash2 } from "./understory_hash.js";
import { GeometryBuilder, maxAttributeValue } from "./understory_geometry_builder.js";
import {
  CLASS_SALT, GREEN_DARK, GREEN_LIGHT, FERN_GREEN, FLOWER_STEM, FLOWER_PINK, FLOWER_CENTER,
  BARK, BARK_DARK, DEAD_WOOD, SHRUB_LEAF, SAPLING_LEAF, FERN_NEEDLE, AXIS_Y,
  type Rng,
} from "./understory_geometry_types.js";

export type { LeafShape, NeedleShape, Rng } from "./understory_geometry_types.js";
export { GeometryBuilder, maxAttributeValue } from "./understory_geometry_builder.js";

export type UnderstoryGeometryMap = Record<UnderstoryClass, THREE.BufferGeometry>;

const GROUND_LITTER_DARK = new THREE.Color(0x3b3324);
const GROUND_LITTER_LIGHT = new THREE.Color(0x786646);

function classSeed(seed: number, cls: UnderstoryClass): number {
  return (Math.floor(seed) ^ CLASS_SALT[cls]) | 0;
}

function makeRng(seed: number): Rng {
  let counter = 0;
  const next = (): number => understoryHash2(counter++, 0x68bc, seed);
  return {
    float: () => next(),
    int: (count: number) => Math.floor(next() * count),
  };
}

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
  const rng = makeRng(classSeed(settings.seed, cls));
  if (cls === "shrub") appendShrub(builder, settings.classes.shrub.windWeight, rng);
  else if (cls === "fern") appendFern(builder, settings.classes.fern.windWeight, rng);
  else if (cls === "sapling") appendSapling(builder, settings.classes.sapling.windWeight, rng);
  else if (cls === "flower") appendFlower(builder, settings.classes.flower.windWeight, rng);
  else if (cls === "dead_log") appendDeadLog(builder);
  else appendStump(builder);
  appendGroundLitter(builder, rng, groundLitterCount(cls));
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

function appendShrub(builder: GeometryBuilder, wind: number, rng: Rng): void {
  const stems = 3 + rng.int(2);
  for (let si = 0; si < stems; si++) {
    const azimuth = (si / stems) * Math.PI * 2 + rng.float();
    const lean = 0.12 + rng.float() * 0.2;
    const len = 0.7 + rng.float() * 0.25;
    const start = new THREE.Vector3(Math.cos(azimuth) * 0.04, 0, Math.sin(azimuth) * 0.04);
    const dir = new THREE.Vector3(Math.cos(azimuth) * lean, 1, Math.sin(azimuth) * lean).normalize();
    const end = start.clone().addScaledVector(dir, len);
    builder.addCylinder(start, end, 0.022, 0.009, 5, BARK, wind * 0.3);
    const outward = new THREE.Vector3(Math.cos(azimuth), 0.5, Math.sin(azimuth)).normalize();
    for (let c = 0; c < 3; c++) {
      const t = 0.55 + c * 0.15 + rng.float() * 0.05;
      const pos = start.clone().lerp(end, t);
      builder.addLeafCluster(pos, outward, 0.85 + rng.float() * 0.3, 2, SHRUB_LEAF, GREEN_DARK, GREEN_LIGHT, wind, rng);
    }
  }
}

function appendFern(builder: GeometryBuilder, wind: number, rng: Rng): void {
  const fronds = 6 + rng.int(2);
  const q = new THREE.Quaternion();
  const qt = new THREE.Quaternion();
  const m = new THREE.Matrix4();
  const one = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < fronds; i++) {
    const az = (i / fronds) * Math.PI * 2 + rng.float() * 0.6;
    const pitch = 0.75 + rng.float() * 0.4;
    q.setFromAxisAngle(AXIS_Y, az);
    qt.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -(Math.PI / 2 - pitch));
    q.multiply(qt);
    const pos = new THREE.Vector3(Math.cos(az) * 0.03, 0.02, Math.sin(az) * 0.03);
    const scale = 0.5 + rng.float() * 0.35;
    m.compose(pos, q, one);
    const color = FERN_GREEN.clone().lerp(GREEN_LIGHT, rng.float() * 0.4);
    builder.addNeedleSpray(m, FERN_NEEDLE, scale, color, wind, rng);
  }
}

function appendSapling(builder: GeometryBuilder, wind: number, rng: Rng): void {
  const trunkH = 0.95 + rng.float() * 0.2;
  const top = new THREE.Vector3(0, trunkH, 0);
  builder.addCylinder(new THREE.Vector3(0, 0, 0), top, 0.05, 0.022, 6, BARK, wind * 0.3);
  const branches = 3 + rng.int(2);
  const tips: { pos: THREE.Vector3; dir: THREE.Vector3 }[] = [];
  for (let i = 0; i < branches; i++) {
    const az = (i / branches) * Math.PI * 2 + rng.float();
    const t = 0.55 + (i / branches) * 0.3;
    const branchStart = new THREE.Vector3(0, trunkH * t, 0);
    const branchLen = 0.18 + rng.float() * 0.12;
    const dir = new THREE.Vector3(Math.cos(az) * 0.8, 0.6, Math.sin(az) * 0.8).normalize();
    const branchEnd = branchStart.clone().addScaledVector(dir, branchLen);
    builder.addCylinder(branchStart, branchEnd, 0.018, 0.008, 4, BARK, wind * 0.5);
    tips.push({ pos: branchEnd, dir });
  }
  builder.addLeafCluster(top, AXIS_Y, 1.0, 3, SAPLING_LEAF, GREEN_DARK, GREEN_LIGHT, wind, rng);
  for (const tip of tips) {
    builder.addLeafCluster(tip.pos, tip.dir, 0.9 + rng.float() * 0.2, 3, SAPLING_LEAF, GREEN_DARK, GREEN_LIGHT, wind, rng);
  }
}

function appendFlower(builder: GeometryBuilder, wind: number, rng: Rng): void {
  const H = 0.28 + rng.float() * 0.2;
  const sway = (rng.float() - 0.5) * 0.25;
  const top = new THREE.Vector3(sway * H, H, sway * H * 0.6);
  const mid = new THREE.Vector3(sway * H * 0.4, H * 0.55, 0);
  const N = new THREE.Vector3(0, 0, 1);
  for (let pl = 0; pl < 2; pl++) {
    const w = 0.006;
    const ox = pl === 0 ? w : 0;
    const oz = pl === 0 ? 0 : w;
    const a0 = builder.addVertex(new THREE.Vector3(-ox, 0, -oz), N, FLOWER_STEM, wind * 0.4, [0, 0]);
    const a1 = builder.addVertex(new THREE.Vector3(ox, 0, oz), N, FLOWER_STEM, wind * 0.4, [1, 0]);
    const b0 = builder.addVertex(new THREE.Vector3(mid.x - ox, mid.y, mid.z - oz), N, FLOWER_STEM, wind * 0.6, [0, 0.5]);
    const b1 = builder.addVertex(new THREE.Vector3(mid.x + ox, mid.y, mid.z + oz), N, FLOWER_STEM, wind * 0.6, [1, 0.5]);
    const c0 = builder.addVertex(new THREE.Vector3(top.x - ox * 0.6, top.y, top.z - oz * 0.6), N, FLOWER_STEM, wind, [0, 1]);
    const c1 = builder.addVertex(new THREE.Vector3(top.x + ox * 0.6, top.y, top.z + oz * 0.6), N, FLOWER_STEM, wind, [1, 1]);
    builder.addQuad(a0, a1, b1, b0);
    builder.addQuad(b0, b1, c1, c0);
  }
  const leafColor = GREEN_DARK.clone().lerp(GREEN_LIGHT, 0.2);
  const leaves = 2 + rng.int(2);
  for (let i = 0; i < leaves; i++) {
    const az = rng.float() * Math.PI * 2;
    const ll = 0.07 + rng.float() * 0.06;
    const lx = Math.cos(az);
    const lz = Math.sin(az);
    const y0 = 0.02 + rng.float() * H * 0.3;
    const up = new THREE.Vector3(0, 1, 0);
    const a0 = builder.addVertex(new THREE.Vector3(lx * 0.01, y0, lz * 0.01), up, leafColor, wind * 0.7, [0, 0]);
    const a1 = builder.addVertex(new THREE.Vector3(lx * 0.01 - lz * 0.012, y0 + 0.005, lz * 0.01 + lx * 0.012), up, leafColor, wind * 0.7, [1, 0]);
    const b0 = builder.addVertex(new THREE.Vector3(lx * ll, y0 + ll * 0.5, lz * ll), up, leafColor, wind, [0, 1]);
    const b1 = builder.addVertex(new THREE.Vector3(lx * ll - lz * 0.01, y0 + ll * 0.5 + 0.005, lz * ll + lx * 0.01), up, leafColor, wind, [1, 1]);
    builder.addQuad(a0, a1, b1, b0);
  }
  const cx = top.x;
  const cy = H + 0.02;
  const cz = top.z;
  const s = 0.05 + rng.float() * 0.02;
  const up = new THREE.Vector3(0, 1, 0.2).normalize();
  const petals = 8 + rng.int(4);
  for (let i = 0; i < petals; i++) {
    const az = (i / petals) * Math.PI * 2;
    const dx = Math.cos(az);
    const dz = Math.sin(az);
    const pw = s * 0.3;
    const plen = s;
    const a0 = builder.addVertex(new THREE.Vector3(cx + dx * s * 0.18 - dz * pw * 0.5, cy, cz + dz * s * 0.18 + dx * pw * 0.5), up, FLOWER_PINK, wind * 0.9, [0, 0]);
    const a1 = builder.addVertex(new THREE.Vector3(cx + dx * s * 0.18 + dz * pw * 0.5, cy, cz + dz * s * 0.18 - dx * pw * 0.5), up, FLOWER_PINK, wind * 0.9, [1, 0]);
    const b0 = builder.addVertex(new THREE.Vector3(cx + dx * plen - dz * pw * 0.25, cy + s * 0.16, cz + dz * plen + dx * pw * 0.25), up, FLOWER_PINK, wind * 0.9, [0, 1]);
    const b1 = builder.addVertex(new THREE.Vector3(cx + dx * plen + dz * pw * 0.25, cy + s * 0.16, cz + dz * plen - dx * pw * 0.25), up, FLOWER_PINK, wind * 0.9, [1, 1]);
    builder.addQuad(a0, a1, b1, b0);
  }
  const center = builder.addVertex(new THREE.Vector3(cx, cy + s * 0.08, cz), AXIS_Y, FLOWER_CENTER, wind * 0.6, [0.5, 0.5]);
  const ringN = 6;
  const ring: number[] = [];
  for (let i = 0; i <= ringN; i++) {
    const az = (i / ringN) * Math.PI * 2;
    ring.push(builder.addVertex(new THREE.Vector3(cx + Math.cos(az) * s * 0.2, cy + s * 0.03, cz + Math.sin(az) * s * 0.2), AXIS_Y, FLOWER_CENTER, wind * 0.6, [0.5, 0.5]));
  }
  for (let i = 0; i < ringN; i++) builder.addTriangle(center, ring[i + 1], ring[i]);
}

function appendDeadLog(builder: GeometryBuilder): void {
  builder.addCylinder(new THREE.Vector3(-0.72, 0.18, 0), new THREE.Vector3(0.72, 0.18, 0), 0.18, 0.16, 8, DEAD_WOOD, 0);
  builder.addCylinder(new THREE.Vector3(-0.64, 0.32, 0.04), new THREE.Vector3(-0.32, 0.44, 0.12), 0.04, 0.02, 5, BARK_DARK, 0);
}

function appendStump(builder: GeometryBuilder): void {
  builder.addCylinder(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.42, 0), 0.18, 0.15, 9, BARK, 0);
  builder.addDisk(new THREE.Vector3(0, 0.43, 0), 0.15, 9, DEAD_WOOD);
}

function groundLitterCount(cls: UnderstoryClass): number {
  if (cls === "fern") return 4;
  if (cls === "dead_log") return 4;
  if (cls === "shrub" || cls === "stump") return 3;
  if (cls === "sapling") return 2;
  return 0;
}

function appendGroundLitter(builder: GeometryBuilder, rng: Rng, count: number): void {
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < count; i++) {
    const radialAngle = rng.float() * Math.PI * 2;
    const radius = 0.12 + rng.float() * 0.42;
    const centerX = Math.cos(radialAngle) * radius;
    const centerZ = Math.sin(radialAngle) * radius;
    const yaw = rng.float() * Math.PI * 2;
    const length = 0.10 + rng.float() * 0.12;
    const width = 0.025 + rng.float() * 0.035;
    const dirX = Math.cos(yaw);
    const dirZ = Math.sin(yaw);
    const acrossX = -dirZ;
    const acrossZ = dirX;
    const y = 0.006 + i * 0.0005;
    const color = GROUND_LITTER_DARK.clone().lerp(GROUND_LITTER_LIGHT, 0.2 + rng.float() * 0.65);
    const base = builder.addVertex(
      new THREE.Vector3(centerX - dirX * length * 0.5, y, centerZ - dirZ * length * 0.5),
      up,
      color,
      0,
      [0.5, 0],
    );
    const left = builder.addVertex(
      new THREE.Vector3(centerX - acrossX * width, y + 0.002, centerZ - acrossZ * width),
      up,
      color,
      0,
      [0, 0.5],
    );
    const tip = builder.addVertex(
      new THREE.Vector3(centerX + dirX * length * 0.5, y + 0.008, centerZ + dirZ * length * 0.5),
      up,
      color,
      0,
      [0.5, 1],
    );
    const right = builder.addVertex(
      new THREE.Vector3(centerX + acrossX * width, y + 0.002, centerZ + acrossZ * width),
      up,
      color,
      0,
      [1, 0.5],
    );
    builder.addQuad(base, left, tip, right);
  }
}
