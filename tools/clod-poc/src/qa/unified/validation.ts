import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { normalize, resolve, sep } from "node:path";

export function assertSafeRepositoryPath(path: string, expectedRoot: string): void {
  if (!path || path.includes("\0")) throw new Error(`invalid empty or NUL path: ${path}`);
  const normalized = normalize(path).replaceAll("\\", "/");
  const root = normalize(expectedRoot).replaceAll("\\", "/").replace(/\/$/, "");
  if (normalized.startsWith("../") || normalized === ".." || !normalized.startsWith(`${root}/`)) {
    throw new Error(`path '${path}' must stay under '${expectedRoot}'`);
  }
}

export function verifyOptionalSha256(path: string, expected: string | null): void {
  if (!expected) return;
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error(`invalid SHA-256 for ${path}`);
  if (!existsSync(path)) throw new Error(`hashed file does not exist: ${path}`);
  const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (actual !== expected) throw new Error(`SHA-256 mismatch for ${path}: expected ${expected}, got ${actual}`);
}

export function resolveInsideRepository(repositoryRoot: string, path: string): string {
  const root = resolve(repositoryRoot);
  const candidate = resolve(root, path);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    throw new Error(`path escapes repository: ${path}`);
  }
  return candidate;
}

export function assertUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`duplicate ${label}: ${value}`);
    seen.add(value);
  }
}
