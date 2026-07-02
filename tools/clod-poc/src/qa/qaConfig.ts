import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import type { CliArgs, QaConfig, QaConfigFile } from "./qaTypes.js";

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    config: "config/qa_visual.yaml",
    summary: "",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === "--config" && value) {
      args.config = value;
      i++;
    } else if (arg === "--summary" && value) {
      args.summary = value;
      i++;
    } else if (arg === "--output" && value) {
      args.output = value;
      i++;
    } else {
      throw new Error(`unknown or incomplete argument: ${arg}`);
    }
  }
  if (!args.summary) throw new Error("missing required --summary <path>");
  return args;
}

export function loadQaConfig(path: string): QaConfig {
  const parsed = load(readFileSync(path, "utf8")) as QaConfigFile;
  validateConfig(parsed.qa);
  return parsed.qa;
}

export function validateConfig(config: QaConfig): void {
  const sceneIds = new Set<string>();
  for (const scene of config.scenes) {
    if (sceneIds.has(scene.id)) throw new Error(`duplicate QA scene id: ${scene.id}`);
    sceneIds.add(scene.id);
    if (!scene.checkpoint) throw new Error(`scene ${scene.id} must name a checkpoint`);
    if (!scene.screenshots.length) throw new Error(`scene ${scene.id} must name screenshots`);
    const screenshotIds = new Set(scene.screenshots.map((screenshot) => screenshot.id));
    if (screenshotIds.size !== scene.screenshots.length) throw new Error(`duplicate screenshot id in scene ${scene.id}`);
    for (const probe of scene.probes ?? []) {
      if (!screenshotIds.has(probe.screenshot)) {
        throw new Error(`probe ${probe.id} references unknown screenshot ${probe.screenshot}`);
      }
      if ("region" in probe && !validRegion(probe.region)) throw new Error(`probe ${probe.id} has invalid region`);
      if ("pixel" in probe && !validPixel(probe.pixel)) throw new Error(`probe ${probe.id} has invalid pixel`);
    }
    const checkIds = new Set<string>();
    for (const check of scene.checks ?? []) {
      if (checkIds.has(check.id)) throw new Error(`duplicate check id ${check.id} in scene ${scene.id}`);
      checkIds.add(check.id);
      if (!check.area || !check.field) throw new Error(`check ${check.id} must name an area and field`);
      if (check.max === undefined && check.min === undefined && check.equals === undefined) {
        throw new Error(`check ${check.id} must set at least one of min/max/equals`);
      }
    }
  }
}

function validRegion(region: readonly number[]): boolean {
  return region.length === 4 && region.every((value) => Number.isFinite(value) && value >= 0 && value <= 1) && region[0] < region[2] && region[1] < region[3];
}

function validPixel(pixel: readonly number[]): boolean {
  return pixel.length === 2 && pixel.every((value) => Number.isFinite(value) && value >= 0 && value <= 1);
}
