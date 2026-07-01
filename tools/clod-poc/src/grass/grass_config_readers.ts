import * as THREE from "three";
import type { GrassBladeRows } from "./grass_config_types.js";

export function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function readNumberAtLeast(value: unknown, fallback: number, min: number): number {
  return Math.max(min, readNumber(value, fallback));
}

export function readFraction(value: unknown, fallback: number): number {
  return Math.min(1, Math.max(0, readNumber(value, fallback)));
}

export function readIntegerAtLeast(value: unknown, fallback: number, min: number): number {
  return Math.max(min, Math.floor(readNumber(value, fallback)));
}

export function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function readWindDirection(value: unknown, fallback: [number, number]): [number, number] {
  if (!Array.isArray(value) || value.length < 2) return [...fallback];
  const x = readNumber(value[0], Number.NaN);
  const z = readNumber(value[1], Number.NaN);
  const len = Math.hypot(x, z);
  if (!Number.isFinite(len) || len < 1e-5) return [...fallback];
  return [x / len, z / len];
}

export function warnGrassConfig(message: string, warn?: (message: string) => void): void {
  warn?.(`[grass-config] ${message}`);
}

export function grassRowsForSegments(segments: number, tipHalfWidth = 0): GrassBladeRows {
  const count = Math.max(1, Math.floor(segments));
  const rows: [number, number][] = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const halfWidth = THREE.MathUtils.lerp(1, tipHalfWidth, Math.pow(t, 1.35));
    rows.push([t, halfWidth]);
  }
  return rows;
}
