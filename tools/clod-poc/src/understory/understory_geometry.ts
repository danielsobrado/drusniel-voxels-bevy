import * as THREE from "three";
import { UNDERSTORY_CLASSES, type UnderstoryClass, type UnderstorySettings } from "./understory_config.js";
import { understoryHash2 } from "./understory_hash.js";

export type UnderstoryGeometryMap = Record<UnderstoryClass, THREE.BufferGeometry>;

const GREEN_DARK = new THREE.Color(0x2f5f35);
const GREEN_LIGHT = new THREE.Color(0x6f9f49);
const FERN_GREEN = new THREE.Color(0x3c7a3f);
const FLOWER_STEM = new THREE.Color(0x3d6c35);
const FLOWER_PINK = new THREE.Color(0xdb7fa7);
const FLOWER_CENTER = new THREE.Color(0xffe06b);
const BARK = new THREE.Color(0x6a4932);
const BARK_DARK = new THREE.Color(0x3f2a1e);
const DEAD_WOOD = new THREE.Color(0x80694e);

// Leaf/needle assembly ported from the reference vegetation implementation
// The reference packs (hue, flex, phase, AO) into a vdata vec4; here those fold
// into the existing clod-poc attributes: flex → understoryWindWeight, AO/hue →
// vertex colour. Per-instance phase/worldXZ stay on the instanced attributes.

/** Single-leaf geometry parameters (local: base at origin, blade along +z). */
interface LeafShape {
  /** blade length / width (m) */
  len: number;
  width: number;
  /** width-profile exponent (1 ≈ ellipse, >1 pointier) */
  shapePow: number;
  /** fold along the midrib (V cross-section) */
  fold: number;
  /** downward curl along length */
  curl: number;
}

/** Needle-spray parameters (drooping stem + comb of single-quad needles). */
interface NeedleShape {
  /** single needle length / width (m) */
  len: number;
  width: number;
  /** needles per spray */
  needleCount: number;
  /** arrangement: 0 = flat comb, 1 = radial brush */
  brush: number;
}

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

interface Rng {
  float(): number;
  int(count: number): number;
}

const CLASS_SALT: Record<UnderstoryClass, number> = {
  shrub: 101,
  fern: 211,
  sapling: 307,
  flower: 401,
  dead_log: 509,
  stump: 601,
};

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

// ---------------------------------------------------------------------------
// Understory classes
// ---------------------------------------------------------------------------

const SHRUB_LEAF: LeafShape = { len: 0.14, width: 0.085, shapePow: 1.2, fold: 0.3, curl: 0.25 };
const SAPLING_LEAF: LeafShape = { len: 0.12, width: 0.07, shapePow: 1.2, fold: 0.28, curl: 0.2 };
const FERN_NEEDLE: NeedleShape = { len: 0.065, width: 0.03, needleCount: 9, brush: 0 };

/** Multi-stem shrub: leaning bark stems carrying fanned real-leaf clusters. */
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

/** Fern: rosette of arching pinnate fronds built as drooping needle sprays. */
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

/** Young sapling: a thin trunk with side branches, all tipped with leaf clusters. */
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

/** Flowering plant: thin cross-strip stem, basal leaves, and a real daisy head. */
function appendFlower(builder: GeometryBuilder, wind: number, rng: Rng): void {
  const H = 0.28 + rng.float() * 0.2;
  const sway = (rng.float() - 0.5) * 0.25;
  const top = new THREE.Vector3(sway * H, H, sway * H * 0.6);
  const mid = new THREE.Vector3(sway * H * 0.4, H * 0.55, 0);
  const N = new THREE.Vector3(0, 0, 1);
  // stem: two perpendicular thin strips, sway rising toward the bloom
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
  // basal leaves: small upward-facing bent quads
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
  // daisy head: ring of petals around a small disc fan
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
    ring.push(
      builder.addVertex(new THREE.Vector3(cx + Math.cos(az) * s * 0.2, cy + s * 0.03, cz + Math.sin(az) * s * 0.2), AXIS_Y, FLOWER_CENTER, wind * 0.6, [0.5, 0.5]),
    );
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

  addTriangle(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  addQuad(a: number, b: number, c: number, d: number): void {
    this.indices.push(a, b, c, a, c, d);
  }

  /** Push a vertex transformed by `m` (position + direction). */
  private leafVertex(
    m: THREE.Matrix4,
    px: number, py: number, pz: number,
    nx: number, ny: number, nz: number,
    color: THREE.Color,
    windWeight: number,
    u: number, v: number,
  ): number {
    _p.set(px, py, pz).applyMatrix4(m);
    _n.set(nx, ny, nz).transformDirection(m);
    return this.addVertex(_p, _n, color, windWeight, [u, v], 1);
  }

  /**
   * One leaf: 4-row strip along +z, folded along the midrib and curled toward
   * the tip (~18 tris). Local: base at origin, blade along +z, face up +y.
   * Ported from LeafMesh.buildLeaf; AO edge-darkening folds into vertex colour.
   */
  addLeaf(m: THREE.Matrix4, shape: LeafShape, color: THREE.Color, flex: number): void {
    const ROWS = 4;
    const L = shape.len;
    const W = shape.width;
    const stem = L * 0.14;
    const colEdge = color.clone().multiplyScalar(0.92);
    const rows: number[][] = [];
    for (let i = 0; i <= ROWS; i++) {
      const s = i / ROWS;
      const w = W * Math.pow(Math.sin(Math.PI * Math.min(1, s * 0.86 + 0.07)), shape.shapePow);
      const z = stem + s * (L - stem);
      const curlY = -shape.curl * s * s * L;
      const foldY = shape.fold * w;
      rows.push([
        this.leafVertex(m, -w, curlY - foldY, z, -shape.fold * 0.8, 1, 0, colEdge, flex, 0, s),
        this.leafVertex(m, 0, curlY + foldY * 0.35, z, 0, 1, shape.curl * s, color, flex, 0.5, s),
        this.leafVertex(m, w, curlY - foldY, z, shape.fold * 0.8, 1, 0, colEdge, flex, 1, s),
      ]);
    }
    for (let i = 0; i < ROWS; i++) {
      const a = rows[i] as number[];
      const b = rows[i + 1] as number[];
      this.addQuad(a[0] as number, b[0] as number, b[1] as number, a[1] as number);
      this.addQuad(a[1] as number, b[1] as number, b[2] as number, a[2] as number);
    }
    const p0 = this.leafVertex(m, -W * 0.06, 0, 0, 0, 1, 0, color, flex * 0.7, 0.45, 0);
    const p1 = this.leafVertex(m, W * 0.06, 0, 0, 0, 1, 0, color, flex * 0.7, 0.55, 0);
    const r0 = rows[0] as number[];
    this.addQuad(p0, r0[0] as number, r0[1] as number, p1);
    this.addTriangle(p1, r0[1] as number, r0[2] as number);
  }

  /**
   * `count` leaves fanned around the anchor's outward direction, drooping
   * down-out. Ported from LeafMesh.buildLeafCluster.
   */
  addLeafCluster(
    pos: THREE.Vector3,
    outward: THREE.Vector3,
    scale: number,
    count: number,
    shape: LeafShape,
    colorDark: THREE.Color,
    colorLight: THREE.Color,
    windBase: number,
    rng: Rng,
  ): void {
    const baseQuat = new THREE.Quaternion().setFromUnitVectors(AXIS_Z, outward.clone().normalize());
    const flex = clamp01(windBase + 0.25 + rng.float() * 0.2);
    const spin = new THREE.Quaternion();
    const pitchQuat = new THREE.Quaternion();
    const m = new THREE.Matrix4();
    const scaleVec = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const az = (i / count) * Math.PI * 2 + rng.float() * 0.9;
      const pitch = 0.5 + rng.float() * 0.6;
      spin.setFromAxisAngle(AXIS_Z, az);
      pitchQuat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch);
      const q = baseQuat.clone().multiply(spin).multiply(pitchQuat);
      const s = scale * (0.8 + rng.float() * 0.45) * 0.12;
      scaleVec.set(s, s, s);
      m.compose(pos, q, scaleVec);
      const color = colorDark.clone().lerp(colorLight, rng.float() * 0.5);
      this.addLeaf(m, shape, color, flex);
    }
  }

  /**
   * Needle spray: drooping stem strip + single-quad needles in a flat comb (or
   * radial brush). Local: along +z. Ported from LeafMesh.buildNeedleSpray.
   */
  addNeedleSpray(
    m: THREE.Matrix4,
    shape: NeedleShape,
    scale: number,
    color: THREE.Color,
    flex: number,
    rng: Rng,
  ): void {
    const SEGS = 4;
    const L = scale;
    const stemPts: THREE.Vector3[] = [];
    let dz = 1;
    let dy = 0;
    let z = 0;
    let y = 0;
    for (let i = 0; i <= SEGS; i++) {
      stemPts.push(new THREE.Vector3(0, y, z));
      const step = L / SEGS;
      dy -= 0.16 * (i / SEGS);
      const dl = Math.hypot(dy, dz);
      z += (dz / dl) * step;
      y += (dy / dl) * step;
    }
    const sw = L * 0.012 + 0.002;
    const stemColor = color.clone().multiplyScalar(0.85);
    const stemRows: number[][] = [];
    for (let i = 0; i <= SEGS; i++) {
      const p = stemPts[i] as THREE.Vector3;
      const w = sw * (1 - (i / SEGS) * 0.7);
      stemRows.push([
        this.leafVertex(m, p.x - w, p.y, p.z, 0, 1, 0, stemColor, flex, 0.48, i / SEGS),
        this.leafVertex(m, p.x + w, p.y, p.z, 0, 1, 0, stemColor, flex, 0.52, i / SEGS),
      ]);
    }
    for (let i = 0; i < SEGS; i++) {
      const a = stemRows[i] as number[];
      const b = stemRows[i + 1] as number[];
      this.addQuad(a[0] as number, b[0] as number, b[1] as number, a[1] as number);
    }
    const count = shape.needleCount;
    const nl = shape.len;
    const nw = shape.width;
    const base = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const tip = new THREE.Vector3();
    const across = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const s = (i + 0.5) / count;
      const idxF = s * SEGS;
      const i0 = Math.min(SEGS - 1, Math.floor(idxF));
      const f = idxF - i0;
      base.copy(stemPts[i0] as THREE.Vector3).lerp(stemPts[i0 + 1] as THREE.Vector3, f);
      const side = i % 2 === 0 ? 1 : -1;
      const layer = i % 4 < 2 ? 1 : 0;
      const az = shape.brush > 0.5
        ? rng.float() * Math.PI * 2
        : side * (1.05 + (rng.float() - 0.5) * 0.85);
      const elev = shape.brush > 0.5
        ? (rng.float() - 0.2) * 1.1
        : (layer === 1 ? 0.42 : 0.02) + (rng.float() - 0.5) * 0.3;
      const swing = (rng.float() - 0.5) * 0.3 + s * 0.55;
      dir.set(
        Math.sin(az) * Math.cos(elev),
        Math.sin(elev),
        Math.cos(az) * Math.cos(elev) * 0.35 + swing,
      ).normalize();
      const lenJ = nl * (0.75 + rng.float() * 0.5) * (0.65 + 0.35 * Math.sin(Math.PI * Math.min(1, s * 1.18)));
      tip.copy(base).addScaledVector(dir, lenJ);
      across.set(-dir.z, 0, dir.x).normalize().multiplyScalar(nw * 0.5);
      nrm.set(0, 1, 0).addScaledVector(dir, -0.25).normalize();
      const a0 = this.leafVertex(m, base.x - across.x, base.y, base.z - across.z, nrm.x, nrm.y, nrm.z, color, flex, 0, 0);
      const a1 = this.leafVertex(m, base.x + across.x, base.y, base.z + across.z, nrm.x, nrm.y, nrm.z, color, flex, 1, 0);
      const b0 = this.leafVertex(m, tip.x - across.x * 0.25, tip.y, tip.z - across.z * 0.25, nrm.x, nrm.y, nrm.z, color, flex * 1.15, 0.4, 1);
      const b1 = this.leafVertex(m, tip.x + across.x * 0.25, tip.y, tip.z + across.z * 0.25, nrm.x, nrm.y, nrm.z, color, flex * 1.15, 0.6, 1);
      this.addQuad(a0, b0, b1, a1);
    }
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
