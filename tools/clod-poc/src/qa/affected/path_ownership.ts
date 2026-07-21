import { readFileSync } from "node:fs";
import { load } from "js-yaml";

export interface QaPathRule {
  id: string;
  patterns: string[];
  battery: "clod-smoke" | "clod-full";
  scripts: string[];
}

export interface QaPathOwnershipConfig {
  schemaVersion: 1;
  defaultBattery: "clod-smoke" | "clod-full";
  rules: QaPathRule[];
}

export interface QaAffectedPlan {
  battery: "clod-smoke" | "clod-full";
  scripts: string[];
  changedFiles: string[];
  matchedRules: string[];
}

export function loadQaPathOwnership(path: string): QaPathOwnershipConfig {
  const file = object(load(readFileSync(path, "utf8")), path, ["qa_path_ownership"]);
  const root = object(file.qa_path_ownership, `${path}.qa_path_ownership`, ["schema_version", "default_battery", "rules"]);
  if (root.schema_version !== 1) throw new Error(`${path}.qa_path_ownership.schema_version must equal 1`);
  return {
    schemaVersion: 1,
    defaultBattery: battery(root.default_battery, `${path}.qa_path_ownership.default_battery`),
    rules: array(root.rules, `${path}.qa_path_ownership.rules`).map((entry, index) => parseRule(entry, `${path}.qa_path_ownership.rules[${index}]`)),
  };
}

export function buildQaAffectedPlan(
  config: QaPathOwnershipConfig,
  changedFiles: readonly string[],
): QaAffectedPlan {
  const normalizedFiles = [...new Set(changedFiles.map(normalizePath).filter(Boolean))].sort();
  const matched = config.rules.filter((rule) => normalizedFiles.some((file) => rule.patterns.some((pattern) => globMatches(pattern, file))));
  const batteryId = matched.some((rule) => rule.battery === "clod-full") ? "clod-full" : config.defaultBattery;
  return {
    battery: batteryId,
    scripts: [...new Set(matched.flatMap((rule) => rule.scripts))].sort(),
    changedFiles: normalizedFiles,
    matchedRules: matched.map((rule) => rule.id),
  };
}

export function globMatches(pattern: string, path: string): boolean {
  const normalizedPattern = normalizePath(pattern);
  const normalizedPath = normalizePath(path);
  const tokenized = normalizedPattern
    .replaceAll("**", "\u0000")
    .replaceAll("*", "\u0001");
  const expression = tokenized
    .replace(/[.+?^${}()|[\]\\]/gu, "\\$&")
    .replaceAll("\u0000", ".*")
    .replaceAll("\u0001", "[^/]*");
  return new RegExp(`^${expression}$`, "u").test(normalizedPath);
}

function parseRule(raw: unknown, path: string): QaPathRule {
  const value = object(raw, path, ["id", "patterns", "battery", "scripts"]);
  const patterns = strings(value.patterns, `${path}.patterns`);
  if (patterns.length === 0) throw new Error(`${path}.patterns must not be empty`);
  return {
    id: identifier(value.id, `${path}.id`),
    patterns,
    battery: battery(value.battery, `${path}.battery`),
    scripts: strings(value.scripts, `${path}.scripts`),
  };
}

function normalizePath(value: string): string {
  return value.trim().replaceAll("\\", "/").replace(/^\.\//u, "");
}
function battery(raw: unknown, path: string): "clod-smoke" | "clod-full" {
  if (raw !== "clod-smoke" && raw !== "clod-full") throw new Error(`${path} must be clod-smoke or clod-full`);
  return raw;
}
function object(raw: unknown, path: string, allowed?: readonly string[]): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${path} must be an object`);
  const value = raw as Record<string, unknown>;
  if (allowed) for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${path}.${key} is unknown`);
  return value;
}
function array(raw: unknown, path: string): unknown[] { if (!Array.isArray(raw)) throw new Error(`${path} must be an array`); return raw; }
function text(raw: unknown, path: string): string { if (typeof raw !== "string" || raw.trim().length === 0) throw new Error(`${path} must be text`); return raw; }
function identifier(raw: unknown, path: string): string { const value = text(raw, path); if (!/^[a-z0-9][a-z0-9-]*$/u.test(value)) throw new Error(`${path} is invalid`); return value; }
function strings(raw: unknown, path: string): string[] { return array(raw, path).map((entry, index) => text(entry, `${path}[${index}]`)); }
