import * as THREE from "three";
import { ACESFilmicToneMapping } from "three";
import { WebGPURenderer } from "three/webgpu";
import phase1ConfigText from "../../config/phase1_terrain.yaml?raw";
import { browserGate } from "../core/browser_gate.js";
import { PHASE0 } from "../core/constants.js";
import {
  buildRequiredLimits,
  describeDiagnostics,
  failLoud,
  installGlobalErrorHooks,
  probeWebGPU,
} from "../core/diagnostics.js";
import { EngineStatsTracker } from "../core/engine_stats.js";
import { FlyCamera } from "../core/fly_camera.js";
import { initHooks } from "../core/hooks.js";
import { parseCamString } from "../core/params.js";
import { buildHeightfieldLeafNodes } from "../clod/heightfield_leaf_source.js";
import { buildDerivedClodTree } from "../clod/page_tree_builder.js";
import { selectCut, type SelectionState } from "../selection.js";
import { initSimplifier } from "../simplify.js";
import type { ClodPageNode } from "../types.js";
import { HeightfieldSampler } from "./heightfield_sampler.js";
import { normalizePhase1DebugMode, parsePhase1Config, type Phase1DebugMode } from "./phase1_config.js";
import { geometryForPhase1Node, createPhase1TerrainMaterial } from "./phase1_terrain_material.js";
import { generatePhase1Heightfield } from "./terrain_synthesis.js";

const DEFAULT_PHASE1_CAM = "1800,360,3200,2.6500,-0.4300,55";

interface Phase1SceneParams {
  seed: number;
  worldPages: number;
  terrainGrid: number;
  debugMode: Phase1DebugMode;
  freeze: boolean;
  hud: boolean;
  dpr: number | null;
  cam: string | null;
}

function hideNormalAppChrome(): void {
  for (const id of ["clod-left-stack", "project-toolbar", "player-mode-bar", "terraform-menu", "build-progress", "crosshair"]) {
    const element = document.getElementById(id);
    if (!element) continue;
    element.setAttribute("hidden", "");
    element.style.display = "none";
  }
}

function intParam(q: URLSearchParams, key: string, fallback: number, allowed?: readonly number[]): number {
  const raw = q.get(key);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (Number.isInteger(value) && value > 0 && (!allowed || allowed.includes(value))) return value;
  console.warn(`[phase1] invalid ${key}=${raw}; using ${fallback}`);
  return fallback;
}

function numParam(q: URLSearchParams, key: string): number | null {
  const raw = q.get(key);
  if (raw === null) return null;
  const value = Number(raw);
  if (Number.isFinite(value) && value > 0) return value;
  console.warn(`[phase1] invalid ${key}=${raw}; ignoring`);
  return null;
}

function parseSceneParams(): Phase1SceneParams {
  const config = parsePhase1Config(phase1ConfigText);
  const q = new URLSearchParams(window.location.search);
  return {
    seed: intParam(q, "seed", 1) >>> 0,
    worldPages: intParam(q, "world", config.runtime.screenshotWorldPages),
    terrainGrid: intParam(q, "terrainGrid", config.world.baseGrid, [1024, 2048, 4096]),
    debugMode: normalizePhase1DebugMode(q.get("terrainDebug"), config),
    freeze: q.get("freeze") === "1",
    hud: q.get("hud") === "1",
    dpr: numParam(q, "dpr"),
    cam: q.get("cam"),
  };
}

function updateProgress(progress: number, message: string): void {
  if (!window.__drusnielClod) return;
  window.__drusnielClod.progress = progress;
  window.__drusnielClod.progressMsg = message;
}

function allNodes(nodesByLevel: Map<number, ClodPageNode[]>): ClodPageNode[] {
  return [...nodesByLevel.values()].flat();
}

function countLevel(rendered: readonly ClodPageNode[], level: number): number {
  return rendered.filter((node) => node.level === level).length;
}

function countBuiltLevel(nodesByLevel: Map<number, ClodPageNode[]>, level: number): number {
  return nodesByLevel.get(level)?.length ?? 0;
}

export async function runPhase1TerrainScene(): Promise<void> {
  hideNormalAppChrome();
  const hooks = initHooks();
  installGlobalErrorHooks();
  if (!browserGate()) return;

  const q = new URLSearchParams(window.location.search);
  if (q.get("renderer") === "webgl") {
    failLoud("Phase-1 terrain requires WebGPU", ["The gated Phase-1 terrain path does not silently fall back to WebGL."]);
    return;
  }

  const config = parsePhase1Config(phase1ConfigText);
  const params = parseSceneParams();
  updateProgress(0.05, "phase1: probing WebGPU");
  const diagnostics = await probeWebGPU();
  hooks.diag = diagnostics;
  if (!diagnostics.ok) {
    failLoud("WebGPU probe failed", [diagnostics.reason ?? "unknown failure", ...describeDiagnostics(diagnostics)]);
    return;
  }

  updateProgress(0.12, "phase1: creating renderer");
  const renderer = new WebGPURenderer({
    antialias: true,
    trackTimestamp: true,
    requiredLimits: buildRequiredLimits(diagnostics),
  });
  await renderer.init();
  const device = (renderer.backend as unknown as { device?: GPUDevice }).device;
  if (device) {
    let reported = 0;
    device.onuncapturederror = (event: GPUUncapturedErrorEvent) => {
      if (reported++ < 8) console.error("[phase1] WebGPU uncaptured error:", event.error.message);
    };
  }
  renderer.setPixelRatio(params.dpr ?? Math.min(window.devicePixelRatio, PHASE0.dprCap));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101923);
  scene.add(new THREE.HemisphereLight(0xb8d7ff, 0x3b3328, 0.72));
  const sun = new THREE.DirectionalLight(0xfff0d0, 2.2);
  sun.position.set(1800, 2600, 1200);
  scene.add(sun);

  updateProgress(0.2, "phase1: synthesizing heightfield");
  const buildStart = performance.now();
  const heightfield = generatePhase1Heightfield(params.seed, config, params.terrainGrid);
  const sampler = new HeightfieldSampler(heightfield);

  updateProgress(0.52, "phase1: building page cache");
  await initSimplifier();
  const leaves = buildHeightfieldLeafNodes(params.worldPages, sampler, config);
  const pageTree = buildDerivedClodTree(leaves.leafNodes, leaves.worldPages, {
    ...config.clod,
    maxParentLevel: config.clod.maxParentLevel,
  });
  const material = createPhase1TerrainMaterial(params.debugMode);
  const nodeMeshes = new Map<string, THREE.Mesh>();
  for (const node of allNodes(pageTree.nodesByLevel)) {
    const mesh = new THREE.Mesh(geometryForPhase1Node(node, sampler, config, params.debugMode), material);
    mesh.name = `phase1-${node.id}`;
    mesh.visible = false;
    nodeMeshes.set(node.id, mesh);
    scene.add(mesh);
  }
  const buildMs = performance.now() - buildStart;

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, config.runtime.farViewM * 2);
  const flyCamera = new FlyCamera(camera, renderer.domElement);
  flyCamera.setPose(parseCamString(params.cam ?? DEFAULT_PHASE1_CAM) ?? parseCamString(DEFAULT_PHASE1_CAM)!);
  hooks.setPose = (pose) => flyCamera.setPose(pose);
  hooks.getPose = () => flyCamera.getPose();
  hooks.flyCamEnabled = (on) => {
    flyCamera.enabled = on;
  };

  const stats = new EngineStatsTracker(renderer, hooks, diagnostics.features.includes("timestamp-query"));
  stats.stats.counters["phase1.gridSize"] = heightfield.size;
  stats.stats.counters["phase1.worldSizeM"] = heightfield.worldSizeM;
  stats.stats.counters["phase1.heightMin100"] = Math.round(heightfield.minHeight * 100);
  stats.stats.counters["phase1.heightMax100"] = Math.round(heightfield.maxHeight * 100);
  stats.stats.counters["phase1.heightSignature"] = heightfield.signature;
  stats.stats.counters["phase1.leafNodes"] = pageTree.leafNodes;
  stats.stats.counters["phase1.parentNodes"] = pageTree.parentNodes;
  stats.stats.counters["phase1.maxLevel"] = pageTree.maxLevel;
  stats.stats.counters["phase1.parentDerived"] = 1;
  stats.stats.counters["phase1.parentDirectResample"] = 0;
  stats.stats.counters["phase1.maxErrorWorld100"] = Math.round(pageTree.maxErrorWorld * 100);
  stats.stats.counters["phase1.borderChainsChecked"] = pageTree.borderChainsChecked;
  stats.stats.counters["phase1.selectionErrorThresholdPx100"] = Math.round(config.selection.errorThresholdPx * 100);
  stats.stats.counters["phase1.selectionHysteresis100"] = Math.round(config.selection.hysteresisMergeFactor * 100);
  stats.stats.counters["phase1.buildMs100"] = Math.round(buildMs * 100);
  stats.stats.counters["phase1.debugMode"] = config.debug.modes.indexOf(params.debugMode);

  const hud = await import("../ui/hud.js").then(({ Hud }) => new Hud(stats.stats, {
    seed: params.seed,
    scene: "phase1-terrain",
    cam: params.cam,
    hud: params.hud,
    freeze: params.freeze,
    dpr: params.dpr,
    renderer: "webgpu",
    shot: null,
  }, camera));

  let selectionState: SelectionState = { split: new Set() };
  let lastRendered = new Set<string>();
  const settleWaiters: { frames: number; resolve: () => void }[] = [];
  hooks.settle = (frames = 8) => new Promise((resolve) => settleWaiters.push({ frames, resolve }));

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  updateProgress(0.92, "phase1: starting runtime");
  let last = performance.now();
  renderer.setAnimationLoop((timeMs) => {
    const dt = Math.max(0.0001, Math.min((timeMs - last) / 1000, 0.1));
    last = timeMs;
    if (!params.freeze) flyCamera.update(dt);

    const selectStart = performance.now();
    const selection = selectCut(pageTree.roots, {
      thresholdPx: config.selection.errorThresholdPx,
      hysteresisMergeFactor: config.selection.hysteresisMergeFactor,
      enforce21: config.selection.enforce21,
      viewportH: renderer.domElement.height,
      fovY: THREE.MathUtils.degToRad(camera.fov),
      camPos: [camera.position.x, camera.position.y, camera.position.z],
    }, selectionState);
    selectionState = selection.state;
    const nextRendered = new Set(selection.rendered.map((node) => node.id));
    for (const id of lastRendered) {
      if (!nextRendered.has(id)) {
        const mesh = nodeMeshes.get(id);
        if (mesh) mesh.visible = false;
      }
    }
    for (const node of selection.rendered) {
      const mesh = nodeMeshes.get(node.id);
      if (mesh) mesh.visible = true;
    }
    lastRendered = nextRendered;
    const selectionMs = performance.now() - selectStart;
    const renderedTris = selection.rendered.reduce((sum, node) => sum + node.mesh.indices.length / 3, 0);
    stats.stats.counters["phase1.nodesRendered"] = selection.rendered.length;
    stats.stats.counters["phase1.trianglesRendered"] = renderedTris;
    stats.stats.counters["phase1.lod0Nodes"] = countLevel(selection.rendered, 0);
    stats.stats.counters["phase1.lod1Nodes"] = countLevel(selection.rendered, 1);
    stats.stats.counters["phase1.lod2Nodes"] = countLevel(selection.rendered, 2);
    stats.stats.counters["phase1.lod3Nodes"] = countLevel(selection.rendered, 3);
    stats.stats.counters["phase1.builtLod0Nodes"] = countBuiltLevel(pageTree.nodesByLevel, 0);
    stats.stats.counters["phase1.builtLod1Nodes"] = countBuiltLevel(pageTree.nodesByLevel, 1);
    stats.stats.counters["phase1.builtLod2Nodes"] = countBuiltLevel(pageTree.nodesByLevel, 2);
    stats.stats.counters["phase1.builtLod3Nodes"] = countBuiltLevel(pageTree.nodesByLevel, 3);
    stats.stats.counters["phase1.selectionMs100"] = Math.round(selectionMs * 100);

    renderer.render(scene, camera);
    stats.update(dt);
    hud.update(dt);

    for (const waiter of settleWaiters) waiter.frames -= 1;
    const done = settleWaiters.filter((waiter) => waiter.frames <= 0);
    for (const waiter of done) waiter.resolve();
    for (const waiter of done) settleWaiters.splice(settleWaiters.indexOf(waiter), 1);
    if (!hooks.ready && stats.stats.frame >= PHASE0.settleReadyFrames) {
      hooks.ready = true;
      hooks.progress = 1;
      hooks.progressMsg = "ready";
    }
  });
}
