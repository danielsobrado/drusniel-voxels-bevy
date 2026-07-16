import type { QaLane, QaTarget } from "./schema.js";

export function objectValue(value: unknown, path: string, allowed?: readonly string[], optional = false): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object`);
  const result = value as Record<string, unknown>;
  if (allowed) {
    for (const key of Object.keys(result)) if (!allowed.includes(key)) throw new Error(`${path}.${key} is unknown`);
    if (!optional) for (const key of allowed) if (!(key in result)) throw new Error(`${path}.${key} is required`);
  }
  return result;
}
export function listValue(value: unknown, path: string): unknown[] { if (!Array.isArray(value)) throw new Error(`${path} must be an array`); return value; }
export function textValue(value: unknown, path: string): string { if (typeof value !== "string" || !value.trim()) throw new Error(`${path} must be a non-empty string`); return value; }
export function nullableText(value: unknown, path: string): string | null { return value === null ? null : textValue(value, path); }
export function strings(value: unknown, path: string): string[] { return listValue(value, path).map((item, i) => textValue(item, `${path}[${i}]`)); }
export function identifier(value: unknown, path: string): string { const result = textValue(value, path); if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(result)) throw new Error(`${path} contains invalid characters`); return result; }
export function booleanValue(value: unknown, path: string): boolean { if (typeof value !== "boolean") throw new Error(`${path} must be boolean`); return value; }
export function finite(value: unknown, path: string): number { if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be finite`); return value; }
export function nonNegative(value: unknown, path: string): number { const n = finite(value, path); if (n < 0) throw new Error(`${path} must be >= 0`); return n; }
export function positive(value: unknown, path: string): number { const n = finite(value, path); if (n <= 0) throw new Error(`${path} must be > 0`); return n; }
export function unit(value: unknown, path: string): number { const n = finite(value, path); if (n < 0 || n > 1) throw new Error(`${path} must be in [0,1]`); return n; }
export function integer(value: unknown, path: string): number { const n = finite(value, path); if (!Number.isInteger(n)) throw new Error(`${path} must be integer`); return n; }
export function nonNegativeInteger(value: unknown, path: string): number { const n = integer(value, path); if (n < 0) throw new Error(`${path} must be >= 0`); return n; }
export function positiveInteger(value: unknown, path: string): number { const n = integer(value, path); if (n <= 0) throw new Error(`${path} must be > 0`); return n; }
export function exact(value: unknown, expected: number, path: string): void { if (value !== expected) throw new Error(`${path} must equal ${expected}`); }
export function targetValue(value: unknown, path: string): QaTarget { const result = textValue(value, path); if (result !== "clod-poc" && result !== "bevy") throw new Error(`${path} is invalid`); return result; }
export function laneValue(value: unknown, path: string): QaLane { const result = textValue(value, path); if (result !== "static" && result !== "gpu" && result !== "full") throw new Error(`${path} is invalid`); return result; }
export function tuple(value: unknown, length: number, parser: (value: unknown, path: string) => number, path: string): number[] { const result = listValue(value, path); if (result.length !== length) throw new Error(`${path} must have ${length} items`); return result.map((item, i) => parser(item, `${path}[${i}]`)); }
