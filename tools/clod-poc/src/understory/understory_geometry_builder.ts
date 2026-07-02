import * as THREE from "three";
import {
  type LeafShape,
  type NeedleShape,
  type Rng,
  _p,
  _n,
  AXIS_Z,
} from "./understory_geometry_types.js";

function maxAttributeValue(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined): number {
  if (!attribute) return 0;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < attribute.count; i++) max = Math.max(max, attribute.getX(i));
  return max;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

export { maxAttributeValue, clamp01 };

export class GeometryBuilder {
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
    let dy = 0;
    let z = 0;
    let y = 0;
    for (let i = 0; i <= SEGS; i++) {
      stemPts.push(new THREE.Vector3(0, y, z));
      const step = L / SEGS;
      dy -= 0.16 * (i / SEGS);
      const dl = Math.hypot(dy, 1);
      z += (1 / dl) * step;
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
