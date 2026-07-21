import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { UnifiedQaRegistry, UnifiedQaScene } from "./schema.js";
import type { QaBatteryDefinition, QaOrchestrationRegistry } from "./orchestration_schema.js";
import { runQaCommand, type QaCommandContext, type QaCommandResult } from "./command_runner.js";

export interface QaBatteryRunOptions {
  repositoryRoot: string;
  outputDir: string;
  runIndex: number;
  batteryId: string;
  target?: "clod-poc" | "bevy";
}

export interface QaBatteryReport {
  schema_version: 1;
  battery_id: string;
  run_index: number;
  status: "PASS" | "FAIL";
  generated_utc: string;
  targets: string[];
  scenes: string[];
  commands: QaCommandResult[];
  failures: string[];
}

interface ExecutionPlanItem {
  commandId: string;
  sceneId: string;
  target: "clod-poc" | "bevy";
}

export async function runQaBattery(
  orchestration: QaOrchestrationRegistry,
  scenes: UnifiedQaRegistry,
  options: QaBatteryRunOptions,
): Promise<QaBatteryReport> {
  const battery = orchestration.batteries.get(options.batteryId);
  if (!battery) throw new Error(`unknown QA battery ${options.batteryId}`);
  const selectedTargets = options.target ? [options.target] : battery.targets;
  for (const target of selectedTargets) if (!battery.targets.includes(target)) throw new Error(`battery ${battery.id} does not include target ${target}`);
  const selectedScenes = selectBatteryScenes(battery, scenes, selectedTargets);
  const plan = buildExecutionPlan(orchestration, battery, selectedScenes, selectedTargets);
  const commands: QaCommandResult[] = [];
  const failures: string[] = [];
  mkdirSync(options.outputDir, { recursive: true });

  const staticItems = plan.filter((item) => orchestration.commands.get(item.commandId)?.lane === "static");
  const runtimeItems = plan.filter((item) => orchestration.commands.get(item.commandId)?.lane !== "static");
  const staticResults = await Promise.all(staticItems.map((item) => executePlanItem(orchestration, item, options)));
  commands.push(...staticResults);
  for (let index = 0; index < staticItems.length; index++) {
    const item = staticItems[index]!;
    const result = staticResults[index]!;
    if (result.status !== "PASS") failures.push(`${result.command_id}/${result.scene_id}: ${result.status}`);
    const command = orchestration.commands.get(item.commandId)!;
    if (result.status !== "PASS" && !command.continue_on_failure) {
      return finishBatteryReport(battery, options, selectedTargets, selectedScenes, commands, failures);
    }
  }

  for (const item of runtimeItems) {
    const command = orchestration.commands.get(item.commandId);
    if (!command) throw new Error(`execution plan references unknown command ${item.commandId}`);
    const result = await executePlanItem(orchestration, item, options);
    commands.push(result);
    if (result.status !== "PASS") {
      failures.push(`${result.command_id}/${result.scene_id}: ${result.status}`);
      if (!command.continue_on_failure) break;
    }
  }

  return finishBatteryReport(battery, options, selectedTargets, selectedScenes, commands, failures);
}

async function executePlanItem(
  orchestration: QaOrchestrationRegistry,
  item: ExecutionPlanItem,
  options: QaBatteryRunOptions,
): Promise<QaCommandResult> {
  const command = orchestration.commands.get(item.commandId);
  if (!command) throw new Error(`execution plan references unknown command ${item.commandId}`);
  const context: QaCommandContext = {
    repositoryRoot: options.repositoryRoot,
    outputDir: options.outputDir,
    runIndex: options.runIndex,
    sceneId: item.sceneId,
    target: item.target,
  };
  return await runQaCommand(command, context);
}

function finishBatteryReport(
  battery: QaBatteryDefinition,
  options: QaBatteryRunOptions,
  selectedTargets: readonly string[],
  selectedScenes: readonly UnifiedQaScene[],
  commands: QaCommandResult[],
  failures: string[],
): QaBatteryReport {
  const report: QaBatteryReport = {
    schema_version: 1,
    battery_id: battery.id,
    run_index: options.runIndex,
    status: failures.length === 0 ? "PASS" : "FAIL",
    generated_utc: new Date().toISOString(),
    targets: [...selectedTargets],
    scenes: selectedScenes.map((scene) => scene.id),
    commands,
    failures,
  };
  writeBatteryReport(report, options.outputDir);
  return report;
}

export function buildExecutionPlan(
  orchestration: QaOrchestrationRegistry,
  battery: QaBatteryDefinition,
  scenes: readonly UnifiedQaScene[],
  targets: readonly ("clod-poc" | "bevy")[],
): ExecutionPlanItem[] {
  const plan: ExecutionPlanItem[] = [];
  const seen = new Set<string>();
  for (const laneId of battery.lanes) {
    const lane = orchestration.lanes.get(laneId);
    if (!lane) throw new Error(`battery ${battery.id} references unknown lane ${laneId}`);
    const laneTargets = lane.target === "all" ? targets : targets.filter((target) => target === lane.target);
    for (const target of laneTargets) for (const commandId of lane.commands) pushUnique(plan, seen, commandId, "all", target);
  }
  for (const scene of scenes) for (const commandId of scene.specialized_commands) pushUnique(plan, seen, commandId, scene.id, scene.target);
  return plan;
}

function selectBatteryScenes(
  battery: QaBatteryDefinition,
  registry: UnifiedQaRegistry,
  targets: readonly ("clod-poc" | "bevy")[],
): UnifiedQaScene[] {
  const ids = new Set(battery.scenes);
  const selected = registry.scenes.filter((scene) => {
    if (!scene.enabled || !targets.includes(scene.target)) return false;
    if (ids.size === 0 && battery.tags.length === 0) return true;
    return ids.has(scene.id) || (battery.tags.length > 0 && battery.tags.every((tag) => scene.tags.includes(tag)));
  });
  const missing = battery.scenes.filter((id) => !selected.some((scene) => scene.id === id));
  if (missing.length > 0) throw new Error(`battery ${battery.id} has unavailable scenes: ${missing.join(", ")}`);
  return selected;
}

function pushUnique(
  plan: ExecutionPlanItem[],
  seen: Set<string>,
  commandId: string,
  sceneId: string,
  target: "clod-poc" | "bevy",
): void {
  const key = `${commandId}:${sceneId}:${target}`;
  if (seen.has(key)) return;
  seen.add(key);
  plan.push({ commandId, sceneId, target });
}

function writeBatteryReport(report: QaBatteryReport, outputDir: string): void {
  writeFileSync(resolve(outputDir, "battery-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  const lines = [
    "# Unified QA battery",
    "",
    `Battery: \`${report.battery_id}\``,
    `Status: **${report.status}**`,
    "",
    "| Command | Scene | Target | Status | Duration ms |",
    "|---|---|---|---:|---:|",
    ...report.commands.map((command) => `| ${command.command_id} | ${command.scene_id} | ${command.target} | ${command.status} | ${command.duration_ms} |`),
    "",
  ];
  if (report.failures.length > 0) lines.push("## Failures", "", ...report.failures.map((failure) => `- ${failure}`), "");
  writeFileSync(resolve(outputDir, "battery-report.md"), `${lines.join("\n")}\n`);
}
