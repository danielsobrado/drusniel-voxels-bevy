const fs = require("fs");
const path = require("path");

const dir = fs.readFileSync("validation-artifacts/latest-clod-poc-p0-dir.txt", "utf8").trim();
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(dir, "environment.txt"), "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), line.slice(i + 1)];
    }),
);
const summary = JSON.parse(fs.readFileSync(path.join(dir, "perf-p0-webgpu", "summary.json"), "utf8"));

function exitCode(name) {
  const file = path.join(dir, name + ".exit");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : "not run";
}

function fmt(value) {
  if (value === null || value === undefined) return "-";
  if (typeof value !== "number") return String(value);
  if (Math.abs(value) >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2);
}

function metric(result, key) {
  return result.metrics && result.metrics[key] !== undefined ? result.metrics[key] : null;
}

function dyn(result, key) {
  const full = "dynamicResolution." + key;
  if (result.finalCounters && result.finalCounters[full] !== undefined) return result.finalCounters[full];
  if (result.metrics && result.metrics[full] !== undefined) return result.metrics[full];
  return null;
}

const fields = [
  "terrainMaterialCacheHits",
  "terrainMaterialCacheMisses",
  "terrainMaterialCacheReady",
  "terrainMaterialCacheStale",
  "vegetationGpuClustersRejectedEarly",
  "vegetationGpuClustersAccepted",
  "vegetationGpuClustersSummaryMissing",
  "vegetationGpuSourceFarSummary",
  "vegetationGpuSourceTerrainSampler",
  "vegetationGpuSourceFallback",
  "treeGpuPrefilterSourceFarSummaryAvg",
  "treeGpuPrefilterSourceTerrainSamplerAvg",
  "treeGpuPrefilterSourceFallbackAvg",
  "grassGpuPrefilterSourceFarSummaryAvg",
  "grassGpuPrefilterSourceTerrainSamplerAvg",
  "grassGpuPrefilterSourceFallbackAvg",
  "understoryGpuPrefilterSourceFarSummaryAvg",
  "understoryGpuPrefilterSourceTerrainSamplerAvg",
  "understoryGpuPrefilterSourceFallbackAvg",
  "naadf.farSummaryAtlas.memorySavingsPct",
  "naadf.farSummaryAtlas.upload.modeCode",
  "naadf.farSummaryAtlas.upload.fallbackReasonCode",
  "naadf.farSummaryAtlas.upload.dirtyUploads",
  "naadf.farSummaryAtlas.upload.fullUploads",
  "naadf.farSummaryAtlas.upload.dirtyPct",
];

const failedGates = summary.gates.results.filter((gate) => gate.status !== "passed");
const firstFailedCase = summary.cases.find((testCase) => testCase.status === "failed" && testCase.error);
const fallbackRan = fs.existsSync(path.join(dir, "perf-p0-auto-fallback.exit"));
const typePassed = exitCode("typecheck") === "0";
const testPassed = exitCode("test") === "0";
const webgpuCompleted = fs.existsSync(path.join(dir, "perf-p0-webgpu", "summary.json"));
const diagnosis = [];
if (!typePassed || !testPassed) diagnosis.push("typecheck/test failure");
if (firstFailedCase?.error && /adapter|device|webgpu|requestadapter/i.test(firstFailedCase.error)) {
  diagnosis.push("browser/WebGPU environment failure");
}
if (firstFailedCase?.error && !/adapter|device|webgpu|requestadapter/i.test(firstFailedCase.error)) {
  diagnosis.push("runtime fatal");
}
if (summary.gates.status !== "passed") diagnosis.push("P0 evidence gate failure");
if (failedGates.some((gate) => /did not expose|missing/i.test(gate.detail))) {
  diagnosis.push("missing counter instrumentation");
}
if (diagnosis.length === 0) diagnosis.push("clean pass");

const lines = [];
lines.push("# CLOD-POC P0 Troubleshooting Handoff", "");
lines.push("## Tested revision", "");
lines.push("- git commit tested: " + env.git_head);
lines.push("- branch: " + env.git_branch);
lines.push("- artifact dir: " + dir);
lines.push("- timestamp UTC: " + env.timestamp_utc);
lines.push("");
lines.push("## Machine / browser / GPU notes", "");
lines.push("- platform: " + env.platform);
lines.push("- node: " + env.node);
lines.push("- npm: " + env.npm);
lines.push("- P0 baseUrl: " + summary.baseUrl);
lines.push("- requested renderer: " + summary.renderer);
lines.push(
  "- WebGPU browser/device details were not emitted as explicit environment fields in the summary; the run did execute WebGPU cases successfully for four cases.",
);
lines.push("");
lines.push("## Exit codes", "");
lines.push("| command | exit |");
lines.push("| --- | ---: |");
for (const command of ["npm-ci", "typecheck", "test", "perf-p0-webgpu", "perf-p0-auto-fallback"]) {
  const code = exitCode(command);
  if (code !== "not run") lines.push("| " + command + " | " + code + " |");
}
lines.push("");
lines.push("## Command outcomes", "");
lines.push("- TypeScript passed: " + (typePassed ? "yes" : "no"));
lines.push("- Vitest passed: " + (testPassed ? "yes" : "no"));
lines.push("- WebGPU P0 completed: " + (webgpuCompleted ? "yes; summary.json and summary.md were generated" : "no"));
lines.push("- First fatal WebGPU case error: " + (firstFailedCase?.error ?? "-"));
lines.push("- Auto fallback run: " + (fallbackRan ? "yes" : "no; failure was not an adapter/device/browser launch failure"));
lines.push("");
lines.push("## P0 gates", "");
lines.push("- overall status: " + summary.gates.status);
lines.push("- failed count: " + summary.gates.failedCount);
lines.push("");
lines.push("| gate | status | detail |");
lines.push("| --- | --- | --- |");
for (const gate of summary.gates.results) {
  lines.push("| " + gate.name + " | " + gate.status + " | " + gate.detail + " |");
}
lines.push("");
lines.push("## Failed gates", "");
if (failedGates.length) {
  for (const gate of failedGates) lines.push("- " + gate.name + ": " + gate.detail);
} else {
  lines.push("- none");
}
lines.push("");
lines.push("## P0 cases", "");
lines.push("| case | status | renderer | frame p50 | frame p95 | frame p99 | veg p95 | render p95 | warnings | errors | failure |");
lines.push("| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |");
for (const testCase of summary.cases) {
  lines.push(
    "| " +
      testCase.name +
      " | " +
      testCase.status +
      " | " +
      testCase.renderer +
      " | " +
      fmt(metric(testCase, "frameMs.p50")) +
      " | " +
      fmt(metric(testCase, "frameMs.p95")) +
      " | " +
      fmt(metric(testCase, "frameMs.p99")) +
      " | " +
      fmt(metric(testCase, "vegetationTotalMs.p95")) +
      " | " +
      fmt(metric(testCase, "renderMs.p95")) +
      " | " +
      (testCase.warnings ? testCase.warnings.length : 0) +
      " | " +
      (testCase.errors ? testCase.errors.length : 0) +
      " | " +
      (testCase.error || "-") +
      " |",
  );
}
lines.push("");
lines.push("## Evidence counters", "");
lines.push("| case | " + fields.join(" | ") + " | dynamicResolution.active | dynamicResolution.renderScale | dynamicResolution.reason |");
lines.push("| --- | " + fields.map(() => "---:").join(" | ") + " | ---: | ---: | ---: |");
for (const testCase of summary.cases) {
  lines.push(
    "| " +
      testCase.name +
      " | " +
      fields.map((field) => fmt(metric(testCase, field))).join(" | ") +
      " | " +
      fmt(dyn(testCase, "active")) +
      " | " +
      fmt(dyn(testCase, "renderScale")) +
      " | " +
      fmt(dyn(testCase, "reason")) +
      " |",
  );
}
lines.push("");
lines.push("## Dynamic resolution check", "");
for (const testCase of summary.cases) {
  lines.push(
    "- " +
      testCase.name +
      ": active=" +
      fmt(dyn(testCase, "active")) +
      ", renderScale=" +
      fmt(dyn(testCase, "renderScale")) +
      ", reason=" +
      fmt(dyn(testCase, "reason")),
  );
}
lines.push("");
lines.push("## Blunt diagnosis", "");
for (const entry of diagnosis) lines.push("- " + entry);
lines.push("");
lines.push("## Next troubleshooting target", "");
lines.push(
  "Fix the runtime evidence path for far-summary source usage first: the only failed evidence gate is `far-summary-source-evidence`, and passed early-reject cases report far-summary source counts as 0 while terrain-sampler/fallback counts are non-zero. Separately investigate the debug-oracle timeout and combined-case missing `window.__drusnielPerf` snapshot because they are the failed cases behind `cases-passed`.",
);
lines.push("");
lines.push("## Gates object", "");
lines.push("```json");
lines.push(JSON.stringify(summary.gates, null, 2));
lines.push("```");

fs.writeFileSync(path.join(dir, "TROUBLESHOOTING_HANDOFF.md"), lines.join("\n") + "\n");
