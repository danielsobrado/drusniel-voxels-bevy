import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { surfaceHeight } from "../src/terrain/terrain.js";
// Import the specific hydrology modules directly rather than the water barrel
// (src/water/index.js) — the barrel transitively pulls `*.wgsl?raw` imports that
// only resolve under Vite, so importing it from a bare `tsx` CLI throws
// ERR_UNKNOWN_FILE_EXTENSION for .wgsl.
import { HydrologySystem } from "../src/water/hydrologySystem.js";
import { parseWaterConfig, resolveWaterConfig } from "../src/water/water_config_parsing.js";
import { checkHydrologyInvariants } from "../src/water/hydrologyInvariants.js";

const root = resolve(import.meta.dirname, "..");
const waterYaml = readFileSync(resolve(root, "config/water.yaml"), "utf8");
const worldCells = Number(process.argv[2] ?? 512);
const waterConfig = resolveWaterConfig(parseWaterConfig(waterYaml, console.warn), worldCells);
const hydrology = HydrologySystem.build(waterConfig.hydrology, worldCells, { surfaceHeight });
const stats = hydrology.stats;

console.log(`wet cells: ${stats.wetCells}`);
console.log(`river cells: ${stats.riverCells}`);
console.log(`lake cells: ${stats.lakeCells}`);
console.log(`max waterY jump: ${stats.maxWaterYJump.toFixed(4)}`);
console.log(`max flow speed: ${stats.maxFlowSpeed.toFixed(4)}`);
console.log(`moisture range: ${stats.moistureMin.toFixed(4)}..${stats.moistureMax.toFixed(4)}`);
console.log(`far field range: ${stats.waterYFarMin.toFixed(4)}..${stats.waterYFarMax.toFixed(4)}`);
console.log(`body kind counts: ${JSON.stringify(stats.bodyKindCounts)}`);

const invariants = checkHydrologyInvariants(hydrology.grid);
const r = invariants.report;
console.log("--- invariants ---");
console.log(`bodies: ${r.bodyCount} (wet ${r.wetCells}, still ${r.stillCells}, river ${r.riverCells})`);
console.log(`lake flatness max deviation: ${r.lakeFlatnessMaxDeviation.toFixed(4)} m`);
console.log(`river max upward step: ${r.riverMaxUpwardStep.toFixed(4)} m (${r.riverMonotonicViolations} violations)`);
console.log(`within-body max jump: ${r.withinBodyMaxJump.toFixed(4)} m`);
console.log(`wet below bed: ${r.wetBelowBedCount}, wet without body id: ${r.wetWithoutBodyIdCount}, dry-with-water: ${r.dryWithWaterCount}`);
console.log(`invariants: ${invariants.passed ? "PASS" : "FAIL -> " + invariants.failures.join("; ")}`);
if (!invariants.passed) process.exitCode = 1;
