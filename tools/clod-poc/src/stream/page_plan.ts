export function pageKey(level: number, x: number, z: number): string {
  return String(level) + ":" + String(x) + "," + String(z);
}
