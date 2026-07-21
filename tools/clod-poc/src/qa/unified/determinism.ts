import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { UnifiedQaRegistry } from "./schema.js";
import type { QaOrchestrationRegistry } from "./orchestration_schema.js";
import { commandArtifactPaths, type QaResolvedCommandArtifact } from "./command_runner.js";
import { runQaBattery, type QaBatteryReport } from "./battery_runner.js";

export interface QaDeterminismOptions {
  repositoryRoot: string;
  outputDir: string;
  batteryId: string;
  target?: "clod-poc" | "bevy";
}

export interface QaDeterminismArtifactResult {
  command_id: string;
  scene_id: string;
  artifact: string;
  status: "PASS" | "FAIL" | "MISSING";
  left_hash: string | null;
  right_hash: string | null;
  message?: string;
}

export interface QaDeterminismReport {
  schema_version: 1;
  battery_id: string;
  status: "PASS" | "FAIL";
  run_a: QaBatteryReport;
  run_b: QaBatteryReport;
  artifacts: QaDeterminismArtifactResult[];
  failures: string[];
}

export interface QaNumericTolerancePolicy {
  defaultTolerance: number;
  pathTolerances: Readonly<Record<string, number>>;
}

export async function runQaDeterminism(
  orchestration: QaOrchestrationRegistry,
  scenes: UnifiedQaRegistry,
  options: QaDeterminismOptions,
): Promise<QaDeterminismReport> {
  const runAOutput = resolve(options.outputDir, "run-a");
  const runBOutput = resolve(options.outputDir, "run-b");
  const runA = await runQaBattery(orchestration, scenes, { ...options, outputDir: runAOutput, runIndex: 1 });
  const runB = await runQaBattery(orchestration, scenes, { ...options, outputDir: runBOutput, runIndex: 2 });
  const artifacts = compareDeclaredArtifacts(orchestration, runA, runB, options.repositoryRoot, runAOutput, runBOutput);
  const failures: string[] = [];
  if (runA.status !== "PASS") failures.push("run-a failed");
  if (runB.status !== "PASS") failures.push("run-b failed");
  if (!sameCommandOutcomes(runA, runB)) failures.push("fresh-process command outcomes differ");
  failures.push(...artifacts.filter((artifact) => artifact.status !== "PASS").map((artifact) => `${artifact.command_id}/${artifact.scene_id}/${artifact.artifact}: ${artifact.status}`));
  const report: QaDeterminismReport = {
    schema_version: 1,
    battery_id: options.batteryId,
    status: failures.length === 0 ? "PASS" : "FAIL",
    run_a: runA,
    run_b: runB,
    artifacts,
    failures,
  };
  writeFileSync(resolve(options.outputDir, "determinism-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(resolve(options.outputDir, "determinism-report.md"), determinismMarkdown(report));
  return report;
}

function compareDeclaredArtifacts(
  orchestration: QaOrchestrationRegistry,
  runA: QaBatteryReport,
  runB: QaBatteryReport,
  repositoryRoot: string,
  runAOutput: string,
  runBOutput: string,
): QaDeterminismArtifactResult[] {
  const results: QaDeterminismArtifactResult[] = [];
  const rightCommands = new Map(runB.commands.map((command) => [`${command.command_id}:${command.scene_id}:${command.target}`, command]));
  for (const left of runA.commands) {
    const key = `${left.command_id}:${left.scene_id}:${left.target}`;
    if (!rightCommands.has(key)) continue;
    const command = orchestration.commands.get(left.command_id);
    if (!command) continue;
    const leftContext = { repositoryRoot, outputDir: runAOutput, runIndex: 1, sceneId: left.scene_id, target: left.target as "clod-poc" | "bevy" };
    const rightContext = { repositoryRoot, outputDir: runBOutput, runIndex: 2, sceneId: left.scene_id, target: left.target as "clod-poc" | "bevy" };
    const leftArtifacts = commandArtifactPaths(command, leftContext);
    const rightArtifacts = commandArtifactPaths(command, rightContext);
    for (let index = 0; index < leftArtifacts.length; index++) {
      const leftArtifact = leftArtifacts[index];
      const rightArtifact = rightArtifacts[index];
      if (!leftArtifact || !rightArtifact) continue;
      results.push(compareArtifact(left.command_id, left.scene_id, leftArtifact, rightArtifact));
    }
  }
  return results;
}

function compareArtifact(
  commandId: string,
  sceneId: string,
  left: QaResolvedCommandArtifact,
  right: QaResolvedCommandArtifact,
): QaDeterminismArtifactResult {
  if (!existsSync(left.path) || !existsSync(right.path)) {
    return { command_id: commandId, scene_id: sceneId, artifact: basename(left.path), status: "MISSING", left_hash: null, right_hash: null };
  }
  if (left.kind === "json") {
    const leftValue = JSON.parse(readFileSync(left.path, "utf8")) as unknown;
    const rightValue = JSON.parse(readFileSync(right.path, "utf8")) as unknown;
    const differences = compareJsonValues(leftValue, rightValue, new Set(left.ignoreJsonKeys), {
      defaultTolerance: left.numericTolerance,
      pathTolerances: left.numericTolerances,
    });
    return {
      command_id: commandId,
      scene_id: sceneId,
      artifact: basename(left.path),
      status: differences.length === 0 ? "PASS" : "FAIL",
      left_hash: hashNormalizedJson(leftValue, left.ignoreJsonKeys),
      right_hash: hashNormalizedJson(rightValue, right.ignoreJsonKeys),
      ...(differences.length === 0 ? {} : { message: differences.slice(0, 8).join("; ") }),
    };
  }
  const leftHash = hashPath(left.path);
  const rightHash = hashPath(right.path);
  return {
    command_id: commandId,
    scene_id: sceneId,
    artifact: basename(left.path),
    status: leftHash === rightHash ? "PASS" : "FAIL",
    left_hash: leftHash,
    right_hash: rightHash,
  };
}

export function compareJsonValues(
  left: unknown,
  right: unknown,
  ignored: Set<string>,
  tolerance: number | QaNumericTolerancePolicy,
  path = "$",
  differences: string[] = [],
): string[] {
  const key = path.split(".").at(-1) ?? path;
  if (ignored.has(key) || ignored.has(path)) return differences;
  const policy = typeof tolerance === "number"
    ? { defaultTolerance: tolerance, pathTolerances: {} }
    : tolerance;
  if (typeof left === "number" && typeof right === "number") {
    const allowed = toleranceForPath(path, policy);
    if (!Number.isFinite(left) || !Number.isFinite(right) || Math.abs(left - right) > allowed) {
      differences.push(`${path}: ${left} != ${right} (tolerance ${allowed})`);
    }
    return differences;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) differences.push(`${path}.length: ${left.length} != ${right.length}`);
    for (let index = 0; index < Math.min(left.length, right.length); index++) {
      compareJsonValues(left[index], right[index], ignored, policy, `${path}[${index}]`, differences);
    }
    return differences;
  }
  if (isObject(left) && isObject(right)) {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const childKey of keys) compareJsonValues(left[childKey], right[childKey], ignored, policy, `${path}.${childKey}`, differences);
    return differences;
  }
  if (left !== right) differences.push(`${path}: ${String(left)} != ${String(right)}`);
  return differences;
}

function toleranceForPath(path: string, policy: QaNumericTolerancePolicy): number {
  const exact = policy.pathTolerances[path];
  if (exact !== undefined) return exact;
  const normalized = path.replace(/\[\d+\]/gu, "[*]");
  const normalizedTolerance = policy.pathTolerances[normalized];
  if (normalizedTolerance !== undefined) return normalizedTolerance;
  for (const [pattern, value] of Object.entries(policy.pathTolerances)) {
    if (pathPatternMatches(pattern, path)) return value;
  }
  return policy.defaultTolerance;
}

function pathPatternMatches(pattern: string, path: string): boolean {
  const expression = pattern
    .replace(/[.+?^${}()|[\]\\]/gu, "\\$&")
    .replaceAll("\\[\\*\\]", "\\[\\d+\\]")
    .replaceAll("**", ".*")
    .replaceAll("*", "[^.\\[]+");
  return new RegExp(`^${expression}$`, "u").test(path);
}

function sameCommandOutcomes(left: QaBatteryReport, right: QaBatteryReport): boolean {
  const normalize = (report: QaBatteryReport) => report.commands.map((command) => `${command.command_id}:${command.scene_id}:${command.target}:${command.status}:${command.exit_code}`).sort();
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function hashNormalizedJson(value: unknown, ignoredKeys: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(normalizeJson(value, new Set(ignoredKeys)))).digest("hex");
}

function normalizeJson(value: unknown, ignored: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((entry) => normalizeJson(entry, ignored));
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).filter((key) => !ignored.has(key)).sort().map((key) => [key, normalizeJson(value[key], ignored)]));
}

function hashPath(path: string): string {
  const hash = createHash("sha256");
  const stat = lstatSync(path);
  if (stat.isDirectory()) {
    for (const entry of walk(path)) {
      hash.update(entry.relative);
      hash.update(readFileSync(entry.absolute));
    }
  } else hash.update(readFileSync(path));
  return hash.digest("hex");
}

function walk(root: string, current = root): Array<{ absolute: string; relative: string }> {
  const output: Array<{ absolute: string; relative: string }> = [];
  for (const name of readdirSync(current).sort()) {
    const absolute = resolve(current, name);
    if (lstatSync(absolute).isDirectory()) output.push(...walk(root, absolute));
    else output.push({ absolute, relative: absolute.slice(root.length + 1).replaceAll("\\", "/") });
  }
  return output;
}

function isObject(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function determinismMarkdown(report: QaDeterminismReport): string {
  return `# Unified QA determinism\n\nBattery: \`${report.battery_id}\`\n\nStatus: **${report.status}**\n\n${report.failures.map((failure) => `- ${failure}`).join("\n")}\n`;
}
