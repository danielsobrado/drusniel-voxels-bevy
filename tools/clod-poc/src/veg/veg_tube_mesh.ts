/**
 * Generalized-cylinder bark meshing for the vegetation grammar. Ported from the
 * Reference vegetation implementation: each skeleton branch
 * becomes a tube via parallel-transport frames, with trunk root flare and jagged
 * caps on broken branches. Emits clod-poc bark verts (foliageMask 0, flutter 0,
 * windWeight = sway flex; bark colour hue-jittered per branch).
 */

import * as THREE from "three";
import type { VegMeshGrower } from "./veg_mesh_grower.js";
import type { Rng } from "./veg_rng.js";
import type { SkelBranch, Skeleton } from "./veg_types.js";

export interface TubeOpts {
  /** ring vertex count at the branch base (tapers down along the branch) */
  ringSegs: number;
  /** around-tube texture repeats at the base */
  uRepeats: number;
  /** lengthwise texture scale */
  vScale: number;
  /** trunk-only root flare */
  flare?: { amp: number; height: number; lobes: number; phase: number };
  /** jagged cap over ring 0 (free-lying deadfall) */
  capBase?: boolean;
  /** per-branch sway flexibility for treeWind.x */
  swayFlexBase: number;
  swayFlexTip: number;
  /** bark base colour (hue-jittered per branch) */
  color: THREE.Color;
}

const _N = new THREE.Vector3();
const _B = new THREE.Vector3();
const _T = new THREE.Vector3();
const _v = new THREE.Vector3();

/** generalized cylinder along a skeleton branch via parallel transport */
export function tubeForBranch(
  g: VegMeshGrower,
  br: SkelBranch,
  opts: TubeOpts,
  rng: Rng,
): void {
  const n = br.pts.length;
  if (n < 2) return;
  const cr = opts.color.r;
  const cg = opts.color.g;
  const cb = opts.color.b;
  const rings: number[][] = [];
  let lastRingPos: number[] = [];
  let firstRingPos: number[] = [];
  _T.copy(br.dirs[0] as THREE.Vector3);
  const ref = Math.abs(_T.y) < 0.94 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  _N.crossVectors(ref, _T).normalize();
  _B.crossVectors(_T, _N).normalize();

  const segsAround = Math.max(4, opts.ringSegs);
  let vAlong = 0;
  const baseR = Math.max(br.radii[0] as number, 1e-4);

  for (let i = 0; i < n; i++) {
    const p = br.pts[i] as THREE.Vector3;
    const r = br.radii[i] as number;
    if (i > 0) {
      const prev = br.pts[i - 1] as THREE.Vector3;
      vAlong += _v.subVectors(p, prev).length();
      const tPrev = br.dirs[i - 1] as THREE.Vector3;
      const tCur = br.dirs[i] as THREE.Vector3;
      const axis = _v.crossVectors(tPrev, tCur);
      const s = axis.length();
      if (s > 1e-6) {
        axis.multiplyScalar(1 / s);
        const ang = Math.asin(Math.min(1, s));
        _N.applyAxisAngle(axis, ang).normalize();
        _B.applyAxisAngle(axis, ang).normalize();
      }
    }
    const tt = i / (n - 1);
    const rNext = br.radii[Math.min(n - 1, i + 1)] as number;
    const rPrev = br.radii[Math.max(0, i - 1)] as number;
    const slope = ((rPrev - rNext) * (n - 1)) / Math.max(0.05, br.len) * 0.5;
    const ring: number[] = [];
    const ringPos: number[] = [];
    const flex = opts.swayFlexBase + (opts.swayFlexTip - opts.swayFlexBase) * tt;
    for (let k = 0; k <= segsAround; k++) {
      const a = (k / segsAround) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      let rr = r;
      if (opts.flare && br.level === 0) {
        const h = (br.pts[i] as THREE.Vector3).y - (br.pts[0] as THREE.Vector3).y;
        const lobe = Math.pow(
          Math.max(0, Math.cos(opts.flare.lobes * a + opts.flare.phase)),
          1.6,
        );
        rr *= 1 + opts.flare.amp * Math.exp(-h / opts.flare.height) * (0.45 + 0.9 * lobe);
      }
      const dx = _N.x * ca + _B.x * sa;
      const dy = _N.y * ca + _B.y * sa;
      const dz = _N.z * ca + _B.z * sa;
      const tan = br.dirs[i] as THREE.Vector3;
      let nx = dx + tan.x * slope;
      let ny = dy + tan.y * slope;
      let nz = dz + tan.z * slope;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      ringPos.push(p.x + dx * rr, p.y + dy * rr, p.z + dz * rr);
      ring.push(
        g.vertex(
          p.x + dx * rr, p.y + dy * rr, p.z + dz * rr,
          nx, ny, nz,
          (k / segsAround) * opts.uRepeats,
          (vAlong / (Math.PI * 2 * baseR)) * opts.uRepeats * opts.vScale,
          cr, cg, cb,
          flex, 0, 0,
        ),
      );
    }
    rings.push(ring);
    lastRingPos = ringPos;
    if (i === 0) firstRingPos = ringPos;
  }

  // walls: base-ring-first so front faces point OUTWARD
  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i] as number[];
    const b = rings[i + 1] as number[];
    for (let k = 0; k < segsAround; k++) {
      g.quad(a[k] as number, a[k + 1] as number, b[k + 1] as number, b[k] as number);
    }
  }

  // base cap (free-lying pieces): jagged disc facing −T0
  if (opts.capBase && baseR > 0.015) {
    const baseP = br.pts[0] as THREE.Vector3;
    const baseD = br.dirs[0] as THREE.Vector3;
    const first = rings[0] as number[];
    const center = g.vertex(
      baseP.x - baseD.x * baseR * 0.4,
      baseP.y - baseD.y * baseR * 0.4,
      baseP.z - baseD.z * baseR * 0.4,
      -baseD.x, -baseD.y, -baseD.z,
      0.5, 0.5, cr, cg, cb, opts.swayFlexBase, 0, 0,
    );
    const jag: number[] = [];
    for (let k = 0; k <= segsAround; k++) {
      const px = baseP.x + ((firstRingPos[k * 3] as number) - baseP.x) * 0.45;
      const py = baseP.y + ((firstRingPos[k * 3 + 1] as number) - baseP.y) * 0.45;
      const pz = baseP.z + ((firstRingPos[k * 3 + 2] as number) - baseP.z) * 0.45;
      const spike = (rng.float() * 0.9 + 0.25) * baseR * 1.4;
      jag.push(
        g.vertex(
          px - baseD.x * spike, py - baseD.y * spike, pz - baseD.z * spike,
          -baseD.x, -baseD.y, -baseD.z,
          0.5, 0.5, cr, cg, cb, opts.swayFlexBase, 0, 0,
        ),
      );
    }
    for (let k = 0; k < segsAround; k++) {
      g.quad(first[k] as number, jag[k] as number, jag[k + 1] as number, first[k + 1] as number);
      g.tri(jag[k] as number, center, jag[k + 1] as number);
    }
  }

  // tip cap
  const last = rings[rings.length - 1] as number[];
  const tipP = br.pts[n - 1] as THREE.Vector3;
  const tipD = br.dirs[n - 1] as THREE.Vector3;
  const tipR = br.radii[n - 1] as number;
  if (br.broken && tipR > 0.015) {
    const center = g.vertex(
      tipP.x + tipD.x * tipR * 0.4,
      tipP.y + tipD.y * tipR * 0.4,
      tipP.z + tipD.z * tipR * 0.4,
      tipD.x, tipD.y, tipD.z,
      0.5, 0.5, cr, cg, cb, opts.swayFlexTip, 0, 0,
    );
    const jag: number[] = [];
    for (let k = 0; k <= segsAround; k++) {
      const px = tipP.x + ((lastRingPos[k * 3] as number) - tipP.x) * 0.45;
      const py = tipP.y + ((lastRingPos[k * 3 + 1] as number) - tipP.y) * 0.45;
      const pz = tipP.z + ((lastRingPos[k * 3 + 2] as number) - tipP.z) * 0.45;
      const spike = (rng.float() * 0.9 + 0.25) * tipR * 1.4;
      jag.push(
        g.vertex(
          px + tipD.x * spike, py + tipD.y * spike, pz + tipD.z * spike,
          tipD.x, tipD.y, tipD.z,
          0.5, 0.5, cr, cg, cb, opts.swayFlexTip, 0, 0,
        ),
      );
    }
    for (let k = 0; k < segsAround; k++) {
      g.quad(last[k] as number, last[k + 1] as number, jag[k + 1] as number, jag[k] as number);
      g.tri(jag[k + 1] as number, center, jag[k] as number);
    }
  } else {
    const tip = g.vertex(
      tipP.x + tipD.x * tipR * 2.0,
      tipP.y + tipD.y * tipR * 2.0,
      tipP.z + tipD.z * tipR * 2.0,
      tipD.x, tipD.y, tipD.z,
      0.5, vAlong / (Math.PI * 2 * baseR) + 0.2,
      cr, cg, cb, opts.swayFlexTip, 0, 0,
    );
    for (let k = 0; k < segsAround; k++) {
      g.tri(last[k + 1] as number, tip, last[k] as number);
    }
  }
}

/** ring resolution by branch level (LOD scales these down) */
export function ringsForLevel(level: number, lodK: number): number {
  const base = level === 0 ? 14 : level === 1 ? 8 : level === 2 ? 6 : 5;
  return Math.max(4, Math.round(base * lodK));
}

/** mesh every branch of a skeleton into the grower */
export function tubesForSkeleton(
  g: VegMeshGrower,
  skel: Skeleton,
  rng: Rng,
  opts: {
    lodK: number;
    uRepeats: number;
    barkColor: THREE.Color;
    flare?: { amp: number; height: number; lobes: number; phase: number };
    /** skip branches above this level (LOD cut) */
    maxLevel?: number;
    /** keep only every Nth branch of level ≥ 1 (far-LOD bark diet) */
    branchStride?: number;
  },
): void {
  const maxLevel = opts.maxLevel ?? 99;
  const stride = opts.branchStride ?? 1;
  const tint = new THREE.Color();
  let bi = 0;
  for (const br of skel.branches) {
    if (br.level > maxLevel) continue;
    if (br.level >= 1 && stride > 1 && bi++ % stride !== 0) continue;
    const flexB = br.level === 0 ? 0 : br.level === 1 ? 0.12 : 0.3;
    const flexT = br.level === 0 ? 0.05 : br.level === 1 ? 0.35 : 0.7;
    // small per-branch bark hue jitter (replaces the reference vdata hue)
    const jitter = 1 + (rng.float() - 0.5) * 0.18;
    tint.copy(opts.barkColor).multiplyScalar(jitter);
    tubeForBranch(
      g,
      br,
      {
        ringSegs: ringsForLevel(br.level, opts.lodK),
        uRepeats: br.level === 0 ? opts.uRepeats : Math.max(1, Math.round(opts.uRepeats * 0.4)),
        vScale: 1,
        ...(br.level === 0 && opts.flare ? { flare: opts.flare } : {}),
        swayFlexBase: flexB,
        swayFlexTip: flexT,
        color: tint,
      },
      rng,
    );
  }
}
