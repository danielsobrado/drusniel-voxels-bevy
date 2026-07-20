import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import {
  canopyVisibility,
  parseTreeConfig,
  treeImpostorVisibility,
  treeLodDistances,
  type TreeSettings,
} from "../src/trees/index.js";
import { parseCanopyShellConfig } from "../src/canopy/canopy_config.js";
import {
  createCanopyGpuImpostorMaterial,
} from "../src/canopy/canopy_gpu_impostor_material.js";
import { maxCanopyGpuImpostorInstances } from "../src/canopy/canopy_gpu_impostors.js";
import { applyVegetationLodToTrees } from "../src/vegetation/apply_vegetation_lod.js";
import {
  parseVegetationLodConfig,
  validateVegetationLodContract,
} from "../src/vegetation/vegetation_lod_config.js";

const CLOD_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = resolve(CLOD_ROOT, "acceptance-runs/tree-canopy-transition");
const CANOPY_CROWN_CLUSTER_TRIS = 6;

/** Runtime signals the headed browser proof should sample. */
export const TREE_CANOPY_TRANSITION_COUNTERS = [
  "treeStats.impostorTrees",
  "treeStats.gpuVisibleCount",
  "canopy_gpu_impostor_instances",
  "canopy_shell_tris",
] as const;

export interface TreeCanopyTransitionGate {
  readonly distanceM: number;
  readonly treeVisibility: number;
  readonly canopyVisibility: number;
}

export interface TreeCanopyTransitionContractResult {
  readonly passed: boolean;
  readonly failures: readonly string[];
  readonly handoffStartM: number;
  readonly impostorEndM: number;
  readonly gates: readonly TreeCanopyTransitionGate[];
  readonly material: {
    readonly transparent: boolean;
    readonly depthWrite: boolean;
    readonly depthTest: boolean;
    readonly alphaTest: number;
  };
  readonly budget: {
    readonly maxShellTris: number;
    readonly maxInstances: number;
    readonly maxTriangles: number;
  };
}

export interface TreeCanopyRuntimeContract {
  readonly settings: TreeSettings;
  readonly maxShellTris: number;
}

export function loadTreeCanopyRuntimeContract(): TreeCanopyRuntimeContract {
  const treeYaml = readFileSync(resolve(CLOD_ROOT, "config/trees.yaml"), "utf8");
  const canopyYaml = readFileSync(resolve(CLOD_ROOT, "config/canopy_shell.yaml"), "utf8");
  const vegetationYaml = readFileSync(resolve(CLOD_ROOT, "config/vegetation_lod.yaml"), "utf8");

  const vegetation = parseVegetationLodConfig(vegetationYaml);
  const canopy = parseCanopyShellConfig(canopyYaml);
  const settings = applyVegetationLodToTrees(parseTreeConfig(treeYaml), vegetation);
  validateVegetationLodContract(vegetation, settings, canopy);

  return {
    settings,
    maxShellTris: canopy.budgets.maxShellTris,
  };
}

export function evaluateTreeCanopyTransitionContract(
  runtime: TreeCanopyRuntimeContract = loadTreeCanopyRuntimeContract(),
): TreeCanopyTransitionContractResult {
  const { settings, maxShellTris } = runtime;
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
    depthTest: handle.material.depthTest,
    alphaTest: handle.material.alphaTest,
  };
  handle.dispose();
  if (material.transparent) failures.push("canopy impostor material must be opaque (transparent=false)");
  if (!material.depthWrite) failures.push("canopy impostor material must write depth");
  if (!material.depthTest) failures.push("canopy impostor material must test depth");
  if (material.alphaTest !== 0) failures.push(`canopy impostor material alphaTest ${material.alphaTest} must be 0 (alpha hashed)`);

  const maxInstances = maxCanopyGpuImpostorInstances(maxShellTris);
  const maxTriangles = maxInstances * CANOPY_CROWN_CLUSTER_TRIS;
  if (maxTriangles > maxShellTris) {
    failures.push(`canopy crown budget ${maxTriangles} triangles exceeds max_shell_tris ${maxShellTris}`);
  }

  return {
    passed: failures.length === 0,
    failures,
    handoffStartM: startM,
    impostorEndM,
    gates,
    material,
    budget: { maxShellTris, maxInstances, maxTriangles },
  };
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
    `[tree-canopy-transition] PASS handoff=${result.handoffStartM}-${result.impostorEndM}m ` +
    `budget=${result.budget.maxTriangles}/${result.budget.maxShellTris} tris ` +
    `gates=${result.gates.map((gate) => `${gate.distanceM}:${gate.treeVisibility.toFixed(2)}/${gate.canopyVisibility.toFixed(2)}`).join(" ")}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
