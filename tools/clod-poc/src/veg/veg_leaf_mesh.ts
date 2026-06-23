/**
 * Real foliage geometry for the vegetation grammar — folded/curled leaf strips
 * and needle sprays, no alpha cards. Ported from the reference vegetation implementation.
 * (`vegetation/LeafMesh.ts`), adapted to the clod-poc `VegMeshGrower` attribute
 * model: foliage verts carry `treeFoliageMask = 1` (leaf lighting), vertex
 * `color` folds the reference's hue jitter + edge AO, `treeWind.x` = sway flex,
 * `treeWind.y` = leaf flutter.
 */

import { Color, Matrix4, Quaternion, Vector3 } from "three";
import type { VegMeshGrower } from "./veg_mesh_grower.js";
import type { Rng } from "./veg_rng.js";
import type { LeafAnchor, LeafShapeParams } from "./veg_types.js";

const LEAF_FLUTTER = 0.6;
const NEEDLE_FLUTTER = 0.35;

const _p = new Vector3();
const _n = new Vector3();
const _m = new Matrix4();
const _q = new Vector3();
const _qy = new Quaternion();
const _qp = new Quaternion();

function pushXf(
  g: VegMeshGrower,
  m: Matrix4,
  px: number, py: number, pz: number,
  nx: number, ny: number, nz: number,
  u: number, v: number,
  r: number, gg: number, b: number,
  flex: number, flutter: number,
): number {
  _p.set(px, py, pz).applyMatrix4(m);
  _n.set(nx, ny, nz).transformDirection(m);
  return g.vertex(_p.x, _p.y, _p.z, _n.x, _n.y, _n.z, u, v, r, gg, b, flex, flutter, 1);
}

/**
 * One leaf: 4-row strip along +z, folded along the midrib and curled toward the
 * tip (~18 tris). Local: base at origin, blade along +z, face up +y.
 */
export function buildLeaf(
  g: VegMeshGrower,
  m: Matrix4,
  shape: LeafShapeParams,
  color: Color,
  flex: number,
): void {
  const ROWS = 4;
  const L = shape.len;
  const W = shape.width;
  const stem = L * 0.14;
  const er = color.r * 0.92;
  const eg = color.g * 0.92;
  const eb = color.b * 0.92;
  const rows: number[][] = [];
  for (let i = 0; i <= ROWS; i++) {
    const s = i / ROWS;
    const w = W * Math.pow(Math.sin(Math.PI * Math.min(1, s * 0.86 + 0.07)), shape.shapePow);
    const z = stem + s * (L - stem);
    const curlY = -shape.curl * s * s * L;
    const foldY = shape.fold * w;
    rows.push([
      pushXf(g, m, -w, curlY - foldY, z, -shape.fold * 0.8, 1, 0, 0, s, er, eg, eb, flex, LEAF_FLUTTER),
      pushXf(g, m, 0, curlY + foldY * 0.35, z, 0, 1, shape.curl * s, 0.5, s, color.r, color.g, color.b, flex, LEAF_FLUTTER),
      pushXf(g, m, w, curlY - foldY, z, shape.fold * 0.8, 1, 0, 1, s, er, eg, eb, flex, LEAF_FLUTTER),
    ]);
  }
  for (let i = 0; i < ROWS; i++) {
    const a = rows[i] as number[];
    const b = rows[i + 1] as number[];
    g.quad(a[0] as number, b[0] as number, b[1] as number, a[1] as number);
    g.quad(a[1] as number, b[1] as number, b[2] as number, a[2] as number);
  }
  const p0 = pushXf(g, m, -W * 0.06, 0, 0, 0, 1, 0, 0.45, 0, color.r, color.g, color.b, flex * 0.7, LEAF_FLUTTER);
  const p1 = pushXf(g, m, W * 0.06, 0, 0, 0, 1, 0, 0.55, 0, color.r, color.g, color.b, flex * 0.7, LEAF_FLUTTER);
  const r0 = rows[0] as number[];
  g.quad(p0, r0[0] as number, r0[1] as number, p1);
  g.tri(p1, r0[1] as number, r0[2] as number);
}

/**
 * Needle spray: drooping stem strip + `needleCount` single-quad needles in a
 * flat comb (or radial brush). Local: along +z.
 */
export function buildNeedleSpray(
  g: VegMeshGrower,
  m: Matrix4,
  shape: LeafShapeParams,
  scale: number,
  rng: Rng,
  color: Color,
  flex: number,
): void {
  const SEGS = 4;
  const L = scale;
  const stemPts: Vector3[] = [];
  let dz = 1;
  let dy = 0;
  let z = 0;
  let y = 0;
  for (let i = 0; i <= SEGS; i++) {
    stemPts.push(new Vector3(0, y, z));
    const step = L / SEGS;
    dy -= 0.16 * (i / SEGS);
    const dl = Math.hypot(dy, dz);
    z += (dz / dl) * step;
    y += (dy / dl) * step;
  }
  const sw = L * 0.012 + 0.002;
  const sr = color.r * 0.85;
  const sg = color.g * 0.85;
  const sb = color.b * 0.85;
  const stemRows: number[][] = [];
  for (let i = 0; i <= SEGS; i++) {
    const p = stemPts[i] as Vector3;
    const w = sw * (1 - (i / SEGS) * 0.7);
    stemRows.push([
      pushXf(g, m, p.x - w, p.y, p.z, 0, 1, 0, 0.48, i / SEGS, sr, sg, sb, flex, NEEDLE_FLUTTER),
      pushXf(g, m, p.x + w, p.y, p.z, 0, 1, 0, 0.52, i / SEGS, sr, sg, sb, flex, NEEDLE_FLUTTER),
    ]);
  }
  for (let i = 0; i < SEGS; i++) {
    const a = stemRows[i] as number[];
    const b = stemRows[i + 1] as number[];
    g.quad(a[0] as number, b[0] as number, b[1] as number, a[1] as number);
  }
  const count = shape.needleCount;
  const nl = shape.len;
  const nw = shape.width;
  for (let i = 0; i < count; i++) {
    const s = (i + 0.5) / count;
    const idxF = s * SEGS;
    const i0 = Math.min(SEGS - 1, Math.floor(idxF));
    const f = idxF - i0;
    const base = _q.copy(stemPts[i0] as Vector3).lerp(stemPts[i0 + 1] as Vector3, f).clone();
    const side = i % 2 === 0 ? 1 : -1;
    const layer = i % 4 < 2 ? 1 : 0;
    const az = shape.brush > 0.5
      ? rng.float() * Math.PI * 2
      : side * (1.05 + (rng.float() - 0.5) * 0.85);
    const elev = shape.brush > 0.5
      ? (rng.float() - 0.2) * 1.1
      : (layer === 1 ? 0.42 : 0.02) + (rng.float() - 0.5) * 0.3;
    const swing = (rng.float() - 0.5) * 0.3 + s * 0.55;
    const dir = new Vector3(
      Math.sin(az) * Math.cos(elev),
      Math.sin(elev),
      Math.cos(az) * Math.cos(elev) * 0.35 + swing,
    ).normalize();
    const lenJ = nl * (0.75 + rng.float() * 0.5) * (0.65 + 0.35 * Math.sin(Math.PI * Math.min(1, s * 1.18)));
    const tip = base.clone().addScaledVector(dir, lenJ);
    const acrossDir = new Vector3(-dir.z, 0, dir.x).normalize().multiplyScalar(nw * 0.5);
    const nrm = new Vector3(0, 1, 0).addScaledVector(dir, -0.25).normalize();
    const a0 = pushXf(g, m, base.x - acrossDir.x, base.y, base.z - acrossDir.z, nrm.x, nrm.y, nrm.z, 0, 0, color.r, color.g, color.b, flex, NEEDLE_FLUTTER);
    const a1 = pushXf(g, m, base.x + acrossDir.x, base.y, base.z + acrossDir.z, nrm.x, nrm.y, nrm.z, 1, 0, color.r, color.g, color.b, flex, NEEDLE_FLUTTER);
    const b0 = pushXf(g, m, tip.x - acrossDir.x * 0.25, tip.y, tip.z - acrossDir.z * 0.25, nrm.x, nrm.y, nrm.z, 0.4, 1, color.r, color.g, color.b, flex * 1.15, NEEDLE_FLUTTER);
    const b1 = pushXf(g, m, tip.x + acrossDir.x * 0.25, tip.y, tip.z + acrossDir.z * 0.25, nrm.x, nrm.y, nrm.z, 0.6, 1, color.r, color.g, color.b, flex * 1.15, NEEDLE_FLUTTER);
    g.quad(a0, b0, b1, a1);
  }
}

/** Tint a base foliage colour by a per-element hue jitter in [-1,1]. */
function tintLeaf(out: Color, base: Color, hue: number, hueVar: number): Color {
  const k = 1 + hue * hueVar;
  out.r = base.r * k;
  out.g = base.g * k;
  out.b = base.b * k;
  return out;
}

const _leafCol = new Color();

/** leaf cluster: `n` leaves fanned around the anchor's +z */
export function buildLeafCluster(
  g: VegMeshGrower,
  anchor: LeafAnchor,
  shape: LeafShapeParams,
  clusterSize: [number, number],
  rng: Rng,
  baseColor: Color,
  hueVar: number,
): void {
  const n = Math.round(clusterSize[0] + rng.float() * (clusterSize[1] - clusterSize[0]));
  const flex = 0.55 + rng.float() * 0.3;
  for (let i = 0; i < n; i++) {
    const az = (i / n) * Math.PI * 2 + rng.float() * 0.9;
    const pitch = -0.5 - rng.float() * 0.6;
    _qy.setFromAxisAngle(new Vector3(0, 1, 0), az);
    _qp.setFromAxisAngle(new Vector3(1, 0, 0), -pitch);
    const qr = anchor.quat.clone().multiply(_qy).multiply(_qp);
    const s = anchor.scale * (0.8 + rng.float() * 0.45);
    _m.compose(anchor.pos, qr, new Vector3(s, s, s));
    const color = tintLeaf(_leafCol, baseColor, anchor.hue + (rng.float() - 0.5) * 0.4, hueVar);
    buildLeaf(g, _m, shape, color, flex);
  }
}

/** needle spray at an anchor */
export function buildSprayAt(
  g: VegMeshGrower,
  anchor: LeafAnchor,
  shape: LeafShapeParams,
  rng: Rng,
  baseColor: Color,
  hueVar: number,
): void {
  _m.compose(anchor.pos, anchor.quat, new Vector3(1, 1, 1));
  const color = tintLeaf(_leafCol, baseColor, anchor.hue, hueVar);
  buildNeedleSpray(g, _m, shape, anchor.scale, rng, color, 0.5 + rng.float() * 0.3);
}
