import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as THREE from "three";
import {
  DEFAULT_TREE_SETTINGS,
  canopyVisibility,
  treeImpostorVisibility,
  treeLodDistances,
  type TreeSettings,
} from "../src/trees/index.js";
import { createCanopyGpuImpostorMaterial } from "../src/canopy/canopy_gpu_impostor_material.js";

const OUTPUT_DIR = resolve("acceptance-runs/tree-canopy-transition");

/** GPU counter names the browser acceptance harness should sample for this handoff. */
export const TREE_CANOPY_TRANSITION_COUNTERS = [
  "tree_gpu_ring_visible_impostor",
  "tree_gpu_ring_slot_count",
  "canopy_gpu_impostor_instances",
  "canopy_gpu_impostor_triangles",
] as const;

export interface TreeCanopyTransitionGate {
  readonly distanceM: number;
  readonly treeVisibility: number;
  readonly canopyVisibility: number;
}

export interface TreeCanopyTransitionContractResult {
  readonly passed: boolean;
  readonly failures: readonly string[];
  readonly impostorEndM: number;
  readonly gates: readonly TreeCanopyTransitionGate[];
  readonly material: {
    readonly transparent: boolean;
    readonly depthWrite: boolean;
    readonly alphaTest: number;
  };
}

export function evaluateTreeCanopyTransitionContract(
  settings: TreeSettings = DEFAULT_TREE_SETTINGS,
): TreeCanopyTransitionContractResult {
  const failures: string[] = [];
  const startM = settings.lod.canopyFadeStartM;
  const endM = settings.lod.canopyFadeEndM;
  const midM = (startM + endM) * 0.5;

  const impostorEndM = treeLodDistances(settings).impostor;
  requireEqual(failures, "impostor band end", impostorEndM, settings.lod.impostorEndM);

  const gateDistances = [startM, midM, endM];
  const gates: TreeCanopyTransitionGate[] = gateDistances.map((distanceM) => ({
    distanceM,
    treeVisibility: treeImpostorVisibility(distanceM, settings),
    canopyVisibility: canopyVisibility(distanceM, startM, endM),
  }));

  requireClose(failures, `tree visibility at ${startM}m`, gates[0]!.treeVisibility, 1);
  requireClose(failures, `canopy visibility at ${startM}m`, gates[0]!.canopyVisibility, 0);
  requireClose(failures, `tree visibility at ${midM}m`, gates[1]!.treeVisibility, 0.5);
  requireClose(failures, `canopy visibility at ${midM}m`, gates[1]!.canopyVisibility, 0.5);
  requireClose(failures, `tree visibility at ${endM}m`, gates[2]!.treeVisibility, 0);
  requireClose(failures, `canopy visibility at ${endM}m`, gates[2]!.canopyVisibility, 1);
  for (const gate of gates) {
    requireClose(failures, `complementary sum at ${gate.distanceM}m`, gate.treeVisibility + gate.canopyVisibility, 1);
  }

  const handle = createCanopyGpuImpostorMaterial(sampleLighting(), startM, endM);
  const material = {
    transparent: handle.material.transparent,
    depthWrite: handle.material.depthWrite,
    alphaTest: handle.material.alphaTest,
  };
  handle.dispose();
  if (material.transparent) failures.push("canopy impostor material must be opaque (transparent=false)");
  if (!material.depthWrite) failures.push("canopy impostor material must write depth");
  if (material.alphaTest !== 0) failures.push(`canopy impostor material alphaTest ${material.alphaTest} must be 0 (alpha hashed)`);

  return { passed: failures.length === 0, failures, impostorEndM, gates, material };
}

function sampleLighting() {
  return {
    sunDirection: new THREE.Vector3(0.3, 0.8, 0.4).normalize(),
    sunColor: new THREE.Color(1, 0.95, 0.85),
    skyLight: new THREE.Color(0.45, 0.55, 0.65),
    groundLight: new THREE.Color(0.2, 0.18, 0.12),
  };
}

function requireEqual(failures: string[], label: string, actual: number, expected: number): void {
  if (actual !== expected) failures.push(`${label} ${String(actual)} did not equal ${String(expected)}`);
}

function requireClose(failures: string[], label: string, actual: number, expected: number): void {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > 1e-6) {
    failures.push(`${label} ${String(actual)} did not match ${String(expected)}`);
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function main(): void {
  const result = evaluateTreeCanopyTransitionContract();
  const report = { result, counters: TREE_CANOPY_TRANSITION_COUNTERS };
  writeJson(resolve(OUTPUT_DIR, "report.json"), report);
  if (!result.passed) {
    console.error(`[tree-canopy-transition] FAIL\n${result.failures.join("\n")}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `[tree-canopy-transition] PASS impostorEndM=${result.impostorEndM} ` +
    `gates=${result.gates.map((gate) => `${gate.distanceM}:${gate.treeVisibility.toFixed(2)}/${gate.canopyVisibility.toFixed(2)}`).join(" ")}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
