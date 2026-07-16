import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  evaluateRepeatability,
  type RepeatabilityMetrics,
  type RepeatabilityRun,
} from "./long_map_repeatability_analysis.js";

type Json = Record<string, unknown>;

function values(argv: readonly string[], key: string): string[] {
  const result: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === key && argv[index + 1]) result.push(argv[++index]!);
  }
  return result;
}

function movement(report: Json): Json {
  const scenes = Array.isArray(report["scenes"]) ? report["scenes"] as Json[] : [];
  const scene = scenes.find((entry) => entry["movement"] && typeof entry["movement"] === "object");
  if (!scene) throw new Error("acceptance report has no movement scene");
  return scene["movement"] as Json;
}

function number(record: Json, key: string): number {
  const value = Number(record[key]);
  return Number.isFinite(value) ? value : Number.NaN;
}

function environmentKey(report: Json): string {
  const environment = (report["environment"] ?? {}) as Json;
  return JSON.stringify({
    commit: report["commit_sha"],
    browser: environment["browser_version"],
    gpu: environment["gpu"],
    display: environment["display"],
    power: environment["power_profile"],
    viewport: environment["capture_viewport"],
  });
}

function loadRun(path: string, freshProfile: boolean): RepeatabilityRun {
  const absolute = resolve(path);
  const report = JSON.parse(readFileSync(absolute, "utf8")) as Json;
  const source = movement(report);
  const metrics: RepeatabilityMetrics = {
    frameP50Ms: number(source, "frameP50Ms"),
    frameP95Ms: number(source, "frameP95Ms"),
    frameP99Ms: number(source, "frameP99Ms"),
    frameP999Ms: number(source, "frameP999Ms"),
    maxFrameMs: number(source, "maxFrameMs"),
    framesOver16_7Ms: number(source, "framesOver16_7Ms"),
    framesOver33_3Ms: number(source, "framesOver33_3Ms"),
    framesOver100Ms: number(source, "framesOver100Ms"),
    longTaskCount: number(source, "longTaskCount"),
    longestLongTaskMs: number(source, "longestLongTaskMs"),
  };
  return { id: absolute, passed: report["passed"] === true, freshProfile, environmentKey: environmentKey(report), metrics };
}

function markdown(evaluation: ReturnType<typeof evaluateRepeatability>): string {
  const lines = [
    "# Long-map repeatability report",
    "",
    `Status: **${evaluation.passed ? "PASS" : "FAIL"}**`,
    "",
    "| Metric | Median | Worst | Spread |",
    "| --- | ---: | ---: | ---: |",
  ];
  for (const [key, value] of Object.entries(evaluation.metrics)) {
    lines.push(`| ${key} | ${value.median.toFixed(3)} | ${value.worst.toFixed(3)} | ${value.spread.toFixed(3)} |`);
  }
  if (evaluation.failures.length > 0) lines.push("", "## Failures", "", ...evaluation.failures.map((failure) => `- ${failure}`));
  return `${lines.join("\n")}\n`;
}

const args = process.argv.slice(2);
const reports = values(args, "--report");
const fresh = values(args, "--fresh");
const out = resolve(values(args, "--out").at(-1) ?? "repeatability-runs/long-map/report.json");
if (reports.length !== 5 || fresh.length !== 1) throw new Error("provide exactly five --report files and one --fresh file");
const runs = [...reports.map((path) => loadRun(path, false)), loadRun(fresh[0]!, true)];
const evaluation = evaluateRepeatability(runs);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify({ createdAt: new Date().toISOString(), runs, ...evaluation }, null, 2)}\n`);
writeFileSync(out.replace(/\.json$/i, ".md"), markdown(evaluation));
if (!evaluation.passed) process.exitCode = 1;
