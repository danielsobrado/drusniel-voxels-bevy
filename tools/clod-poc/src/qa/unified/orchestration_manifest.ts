import { readFileSync } from "node:fs";
import { isAbsolute, normalize } from "node:path";
import { load } from "js-yaml";
import type { UnifiedQaRegistry } from "./schema.js";
import {
  QA_ORCHESTRATION_SCHEMA_VERSION,
  type QaBatteryDefinition,
  type QaBatteryLane,
  type QaBatteryManifest,
  type QaCommandArtifact,
  type QaCommandDefinition,
  type QaCommandManifest,
  type QaOrchestrationRegistry,
  type QaPlaceholder,
} from "./orchestration_schema.js";

const PROGRAM_ALLOWLIST = new Set(["cargo", "node", "npm", "npx"]);
const PLACEHOLDERS = new Set<QaPlaceholder>(["OUTPUT_DIR", "REPOSITORY_ROOT", "RUN_INDEX", "SCENE_ID", "TARGET"]);

export interface QaOrchestrationPaths {
  commands: string;
  batteries: string;
}

export function loadQaOrchestration(paths: QaOrchestrationPaths, scenes?: UnifiedQaRegistry): QaOrchestrationRegistry {
  const commandManifest = parseCommandManifest(readYaml(paths.commands), paths.commands);
  const batteryManifest = parseBatteryManifest(readYaml(paths.batteries), paths.batteries);
  const commands = uniqueMap(commandManifest.commands, "command");
  const lanes = uniqueMap(batteryManifest.lanes, "lane");
  const batteries = uniqueMap(batteryManifest.batteries, "battery");

  for (const lane of lanes.values()) {
    for (const commandId of lane.commands) {
      const command = commands.get(commandId);
      if (!command) throw new Error(`lane ${lane.id} references unknown command ${commandId}`);
      if (lane.target !== "all" && command.target !== "all" && lane.target !== command.target) {
        throw new Error(`lane ${lane.id} target ${lane.target} cannot use command ${command.id} target ${command.target}`);
      }
    }
  }

  for (const battery of batteries.values()) {
    for (const laneId of battery.lanes) if (!lanes.has(laneId)) throw new Error(`battery ${battery.id} references unknown lane ${laneId}`);
  }

  if (scenes) validateSceneOrchestrationReferences(scenes, commands, batteries);
  return { commands, lanes, batteries };
}

export function validateSceneOrchestrationReferences(
  registry: UnifiedQaRegistry,
  commands: ReadonlyMap<string, QaCommandDefinition>,
  batteries: ReadonlyMap<string, QaBatteryDefinition>,
): void {
  const scenes = new Map(registry.scenes.map((scene) => [scene.id, scene]));
  for (const scene of registry.scenes) {
    for (const commandId of scene.specialized_commands) {
      const command = commands.get(commandId);
      if (!command) throw new Error(`scene ${scene.id} references unknown specialized command ${commandId}`);
      if (command.target !== "all" && command.target !== scene.target) {
        throw new Error(`scene ${scene.id} target ${scene.target} cannot use command ${command.id} target ${command.target}`);
      }
    }
  }
  for (const battery of batteries.values()) {
    for (const sceneId of battery.scenes) {
      const scene = scenes.get(sceneId);
      if (!scene) throw new Error(`battery ${battery.id} references unknown scene ${sceneId}`);
      if (!battery.targets.includes(scene.target)) throw new Error(`battery ${battery.id} excludes target ${scene.target} used by scene ${sceneId}`);
    }
  }
}

function parseCommandManifest(raw: unknown, path: string): QaCommandManifest {
  const file = object(raw, path, ["command_allowlist"]);
  const root = object(file.command_allowlist, `${path}.command_allowlist`, ["schema_version", "commands"]);
  exactInteger(root.schema_version, QA_ORCHESTRATION_SCHEMA_VERSION, `${path}.command_allowlist.schema_version`);
  return {
    schema_version: 1,
    commands: array(root.commands, `${path}.command_allowlist.commands`).map((item, index) => parseCommand(item, `${path}.command_allowlist.commands[${index}]`)),
  };
}

function parseCommand(raw: unknown, path: string): QaCommandDefinition {
  const value = object(raw, path, ["id", "target", "lane", "program", "args", "cwd", "timeout_ms", "continue_on_failure", "environment", "placeholders", "artifacts"]);
  const program = text(value.program, `${path}.program`);
  if (!PROGRAM_ALLOWLIST.has(program)) throw new Error(`${path}.program is not allowlisted: ${program}`);
  const placeholders = strings(value.placeholders, `${path}.placeholders`).map((entry) => {
    if (!PLACEHOLDERS.has(entry as QaPlaceholder)) throw new Error(`${path}.placeholders contains unsupported value ${entry}`);
    return entry as QaPlaceholder;
  });
  const args = strings(value.args, `${path}.args`);
  for (const argument of args) validateTemplate(argument, placeholders, `${path}.args`);
  const cwd = safeRelativePath(text(value.cwd, `${path}.cwd`), `${path}.cwd`);
  const environmentObject = object(value.environment, `${path}.environment`);
  const environment: Record<string, string> = {};
  for (const [key, entry] of Object.entries(environmentObject)) {
    if (!/^[A-Z][A-Z0-9_]*$/u.test(key)) throw new Error(`${path}.environment.${key} is not a safe environment key`);
    environment[key] = text(entry, `${path}.environment.${key}`);
    validateTemplate(environment[key], placeholders, `${path}.environment.${key}`);
  }
  return {
    id: identifier(value.id, `${path}.id`),
    target: targetOrAll(value.target, `${path}.target`),
    lane: lane(value.lane, `${path}.lane`),
    program,
    args,
    cwd,
    timeout_ms: positiveInteger(value.timeout_ms, `${path}.timeout_ms`),
    continue_on_failure: booleanValue(value.continue_on_failure, `${path}.continue_on_failure`),
    environment,
    placeholders,
    artifacts: array(value.artifacts, `${path}.artifacts`).map((item, index) => parseArtifact(item, placeholders, `${path}.artifacts[${index}]`)),
  };
}

function parseArtifact(raw: unknown, placeholders: readonly QaPlaceholder[], path: string): QaCommandArtifact {
  const value = object(raw, path, [
    "path",
    "required",
    "deterministic",
    "kind",
    "ignore_json_keys",
    "numeric_tolerance",
    "numeric_tolerances",
  ]);
  const artifactPath = text(value.path, `${path}.path`);
  validateTemplate(artifactPath, placeholders, `${path}.path`);
  if (!artifactPath.startsWith("${OUTPUT_DIR}/") && artifactPath !== "${OUTPUT_DIR}") {
    throw new Error(`${path}.path must stay below OUTPUT_DIR`);
  }
  const kind = text(value.kind, `${path}.kind`);
  if (!new Set(["file", "directory", "json"]).has(kind)) throw new Error(`${path}.kind is invalid`);
  const toleranceObject = value.numeric_tolerances === undefined
    ? {}
    : object(value.numeric_tolerances, `${path}.numeric_tolerances`);
  const numericTolerances: Record<string, number> = {};
  for (const [jsonPath, tolerance] of Object.entries(toleranceObject)) {
    if (!jsonPath.startsWith("$.")) throw new Error(`${path}.numeric_tolerances.${jsonPath} must start with $.`);
    numericTolerances[jsonPath] = nonNegative(tolerance, `${path}.numeric_tolerances.${jsonPath}`);
  }
  return {
    path: artifactPath,
    required: booleanValue(value.required, `${path}.required`),
    deterministic: booleanValue(value.deterministic, `${path}.deterministic`),
    kind: kind as QaCommandArtifact["kind"],
    ignore_json_keys: strings(value.ignore_json_keys, `${path}.ignore_json_keys`),
    numeric_tolerance: nonNegative(value.numeric_tolerance, `${path}.numeric_tolerance`),
    numeric_tolerances: numericTolerances,
  };
}

function parseBatteryManifest(raw: unknown, path: string): QaBatteryManifest {
  const file = object(raw, path, ["qa_batteries"]);
  const root = object(file.qa_batteries, `${path}.qa_batteries`, ["schema_version", "lanes", "batteries"]);
  exactInteger(root.schema_version, QA_ORCHESTRATION_SCHEMA_VERSION, `${path}.qa_batteries.schema_version`);
  return {
    schema_version: 1,
    lanes: array(root.lanes, `${path}.qa_batteries.lanes`).map((item, index) => parseLane(item, `${path}.qa_batteries.lanes[${index}]`)),
    batteries: array(root.batteries, `${path}.qa_batteries.batteries`).map((item, index) => parseBattery(item, `${path}.qa_batteries.batteries[${index}]`)),
  };
}

function parseLane(raw: unknown, path: string): QaBatteryLane {
  const value = object(raw, path, ["id", "target", "authoritative", "commands"]);
  return {
    id: identifier(value.id, `${path}.id`),
    target: targetOrAll(value.target, `${path}.target`),
    authoritative: booleanValue(value.authoritative, `${path}.authoritative`),
    commands: strings(value.commands, `${path}.commands`).map((entry, index) => identifier(entry, `${path}.commands[${index}]`)),
  };
}

function parseBattery(raw: unknown, path: string): QaBatteryDefinition {
  const value = object(raw, path, ["id", "description", "targets", "lanes", "scenes", "tags"]);
  const targets = strings(value.targets, `${path}.targets`).map((entry, index) => target(entry, `${path}.targets[${index}]`));
  if (new Set(targets).size !== targets.length) throw new Error(`${path}.targets contains duplicates`);
  return {
    id: identifier(value.id, `${path}.id`),
    description: text(value.description, `${path}.description`),
    targets,
    lanes: strings(value.lanes, `${path}.lanes`).map((entry, index) => identifier(entry, `${path}.lanes[${index}]`)),
    scenes: strings(value.scenes, `${path}.scenes`).map((entry, index) => identifier(entry, `${path}.scenes[${index}]`)),
    tags: strings(value.tags, `${path}.tags`),
  };
}

function validateTemplate(value: string, allowed: readonly QaPlaceholder[], path: string): void {
  const matches = value.matchAll(/\$\{([A-Z][A-Z0-9_]*)\}/gu);
  for (const match of matches) {
    const name = match[1] as QaPlaceholder;
    if (!allowed.includes(name)) throw new Error(`${path} uses undeclared placeholder ${name}`);
  }
  if (value.includes("${") && !/^([^$]|\$\{[A-Z][A-Z0-9_]*\})*$/u.test(value)) throw new Error(`${path} contains malformed placeholder syntax`);
}

function safeRelativePath(value: string, path: string): string {
  if (isAbsolute(value)) throw new Error(`${path} must be relative`);
  const normalized = normalize(value).replaceAll("\\", "/");
  if (normalized === ".." || normalized.startsWith("../")) throw new Error(`${path} escapes the repository`);
  return normalized;
}

function uniqueMap<T extends { id: string }>(items: readonly T[], kind: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items) {
    if (result.has(item.id)) throw new Error(`duplicate ${kind} id ${item.id}`);
    result.set(item.id, item);
  }
  return result;
}

function readYaml(path: string): unknown {
  try { return load(readFileSync(path, "utf8")); }
  catch (error) { throw new Error(`failed to parse ${path}: ${error instanceof Error ? error.message : String(error)}`); }
}

function object(raw: unknown, path: string, allowed?: readonly string[]): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${path} must be an object`);
  const value = raw as Record<string, unknown>;
  if (allowed) for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${path}.${key} is unknown`);
  return value;
}
function array(raw: unknown, path: string): unknown[] { if (!Array.isArray(raw)) throw new Error(`${path} must be an array`); return raw; }
function text(raw: unknown, path: string): string { if (typeof raw !== "string" || raw.length === 0) throw new Error(`${path} must be a non-empty string`); return raw; }
function strings(raw: unknown, path: string): string[] { return array(raw, path).map((entry, index) => text(entry, `${path}[${index}]`)); }
function identifier(raw: unknown, path: string): string { const value = text(raw, path); if (!/^[a-z0-9][a-z0-9._-]*$/u.test(value)) throw new Error(`${path} is not a valid identifier`); return value; }
function booleanValue(raw: unknown, path: string): boolean { if (typeof raw !== "boolean") throw new Error(`${path} must be boolean`); return raw; }
function numberValue(raw: unknown, path: string): number { if (typeof raw !== "number" || !Number.isFinite(raw)) throw new Error(`${path} must be finite`); return raw; }
function nonNegative(raw: unknown, path: string): number { const value = numberValue(raw, path); if (value < 0) throw new Error(`${path} must be non-negative`); return value; }
function positiveInteger(raw: unknown, path: string): number { const value = numberValue(raw, path); if (!Number.isInteger(value) || value <= 0) throw new Error(`${path} must be a positive integer`); return value; }
function exactInteger(raw: unknown, expected: number, path: string): void { if (raw !== expected) throw new Error(`${path} must equal ${expected}`); }
function target(raw: unknown, path: string): "clod-poc" | "bevy" { const value = text(raw, path); if (value !== "clod-poc" && value !== "bevy") throw new Error(`${path} is invalid`); return value; }
function targetOrAll(raw: unknown, path: string): "clod-poc" | "bevy" | "all" { const value = text(raw, path); if (value === "all") return value; return target(value, path); }
function lane(raw: unknown, path: string): "static" | "gpu" | "full" { const value = text(raw, path); if (value !== "static" && value !== "gpu" && value !== "full") throw new Error(`${path} is invalid`); return value; }
