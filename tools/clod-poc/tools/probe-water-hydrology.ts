import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { surfaceHeight } from "../src/terrain.js";
import { HydrologySystem, parseWaterConfig, resolveWaterConfig } from "../src/water/index.js";

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
