export type Vec3 = [number, number, number];

const EPS = 1e-12;

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize(a: Vec3): Vec3 | null {
  const len = length(a);
  if (!Number.isFinite(len) || len <= EPS) return null;
  return [a[0] / len, a[1] / len, a[2] / len];
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function triangleArea(a: Vec3, b: Vec3, c: Vec3): number {
  return length(cross(sub(b, a), sub(c, a))) * 0.5;
}

export function triangleNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 | null {
  return normalize(cross(sub(b, a), sub(c, a)));
}

export function triangleMinAngleDegrees(a: Vec3, b: Vec3, c: Vec3): number {
  const ab = length(sub(b, a));
  const bc = length(sub(c, b));
  const ca = length(sub(a, c));
  if (ab <= EPS || bc <= EPS || ca <= EPS) return 0;
  const angleA = angleDegrees(ab, ca, bc);
  const angleB = angleDegrees(ab, bc, ca);
  const angleC = 180 - angleA - angleB;
  return Math.min(angleA, angleB, angleC);
}

export function materialDistanceSquared(a?: readonly number[], b?: readonly number[]): number {
  if (!a || !b) return 0;
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return sum;
}

export function finiteVec3(v: Vec3): boolean {
  return Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);
}

function angleDegrees(sideA: number, sideB: number, opposite: number): number {
  const denom = 2 * sideA * sideB;
  if (denom <= EPS) return 0;
  const cos = Math.max(-1, Math.min(1, (sideA * sideA + sideB * sideB - opposite * opposite) / denom));
  return Math.acos(cos) * 180 / Math.PI;
}
