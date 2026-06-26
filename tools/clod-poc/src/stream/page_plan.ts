export function pageKey(level: number, x: number, z: number): string {
  return String(level) + ":" + String(x) + "," + String(z);
}

export function pageCenterX(x: number, pageSize: number): number {
  return (x + 0.5) * pageSize;
}

export function pageCenterZ(z: number, pageSize: number): number {
  return (z + 0.5) * pageSize;
}
