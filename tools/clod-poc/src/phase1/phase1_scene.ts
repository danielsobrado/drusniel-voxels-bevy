import * as THREE from "three";
import { ACESFilmicToneMapping } from "three";
import { WebGPURenderer } from "three/webgpu";
import GUI from "lil-gui";
import phase1ConfigText from "../../config/phase1_terrain.yaml?raw";
import { defaultBorderCoastOceanConfig, type BorderCoastOceanConfig } from "../config/borderCoastOceanConfig.js";
import { browserGate } from "../core/browser_gate.js";
import { PHASE0 } from "../core/constants.js";
import {
  buildRequiredLimits, describeDiagnostics, failLoud,
  installGlobalErrorHooks, probeWebGPU,
} from "../core/diagnostics.js";
import { EngineStatsTracker } from "../core/engine_stats.js";
import { FlyCamera } from "../core/fly_camera.js";
import { initHooks } from "../core/hooks.js";
import { parseCamString } from "../core/params.js";
import { buildHeightfieldLeafNodes } from "../clod/heightfield_leaf_source.js";
import { buildDerivedClodTree } from "../clod/page_tree_builder.js";
import { initSimplifier } from "../clod/simplify.js";
import { DeepOcean } from "../water/deepOcean.js";
import { SurfBand } from "../water/surfBand.js";
import { HeightfieldSampler } from "./heightfield_sampler.js";
import { parsePhase1Config } from "./phase1_config.js";
import { geometryForPhase1Node, createPhase1TerrainMaterial } from "./phase1_terrain_material.js";
import { generatePhase1Heightfield } from "./terrain_synthesis.js";
import type { Phase1SceneParams } from "./phase1_scene_types.js";
import { DEFAULT_PHASE1_CAM, parseSceneParams } from "./phase1_scene_camera.js";
import { hideNormalAppChrome, updateProgress, failDetails, allNodes } from "./phase1_scene_helpers.js";
import { createSettleManager } from "./phase1_scene_settle.js";
import { createTerrainActions, type Phase1MutableState, type Phase1StaticDeps } from "./phase1_scene_terrain_actions.js";
import { setupPhase1Gui } from "./phase1_scene_gui.js";
import { createPhase1AnimationLoop } from "./phase1_scene_loop.js";

export type { Phase1SceneParams } from "./phase1_scene_types.js";
export { DEFAULT_PHASE1_CAM, parseSceneParams } from "./phase1_scene_camera.js";
export { hideNormalAppChrome, updateProgress, failDetails, allNodes } from "./phase1_scene_helpers.js";
export { createSettleManager } from "./phase1_scene_settle.js";
export { createTerrainActions } from "./phase1_scene_terrain_actions.js";
export { setupPhase1Gui } from "./phase1_scene_gui.js";
export { createPhase1AnimationLoop } from "./phase1_scene_loop.js";

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

  updateProgress(0.05, "phase1: probing WebGPU");
  const diagnostics = await probeWebGPU();
  hooks.diag = diagnostics;
  if (!diagnostics.ok) {
    failLoud("WebGPU probe failed", [diagnostics.reason ?? "unknown failure", ...describeDiagnostics(diagnostics)]);
    return;
  }

  let config: ReturnType<typeof parsePhase1Config>;
  let params: Phase1SceneParams;
  let renderer: WebGPURenderer;
  let scene: THREE.Scene;
  let heightfield: ReturnType<typeof generatePhase1Heightfield>;
  let sampler: HeightfieldSampler;
  let pageTree: ReturnType<typeof buildDerivedClodTree>;
  let nodeMeshes: Map<string, THREE.Mesh>;
  let terrainMaterial: THREE.Material;
  let buildMs: number;
  let coastConfig: BorderCoastOceanConfig;
  let sunDirection: THREE.Vector3;
  try {
    config = parsePhase1Config(phase1ConfigText);
    params = parseSceneParams(phase1ConfigText);
    coastConfig = structuredClone(defaultBorderCoastOceanConfig);
    coastConfig.world.bounds = { min_x: 0, max_x: config.world.sizeM, min_z: 0, max_z: config.world.sizeM };

    updateProgress(0.12, "phase1: creating renderer");
    renderer = new WebGPURenderer({ antialias: true, trackTimestamp: true, requiredLimits: buildRequiredLimits(diagnostics) });
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

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101923);
    scene.add(new THREE.HemisphereLight(0xb8d7ff, 0x3b3328, 0.72));
    const sun = new THREE.DirectionalLight(0xfff0d0, 2.2);
    sun.position.set(1800, 2600, 1200);
    sunDirection = sun.position.clone().normalize();
    scene.add(sun);

    updateProgress(0.2, "phase1: synthesizing heightfield");
    const buildStart = performance.now();
    heightfield = generatePhase1Heightfield(params.seed, config, params.terrainGrid, coastConfig);
    sampler = new HeightfieldSampler(heightfield);

    updateProgress(0.52, "phase1: building page cache");
    await initSimplifier();
    const leaves = buildHeightfieldLeafNodes(params.worldPages, sampler, config);
    pageTree = buildDerivedClodTree(leaves.leafNodes, leaves.worldPages, { ...config.clod, maxParentLevel: config.clod.maxParentLevel });
    terrainMaterial = createPhase1TerrainMaterial(params.debugMode);
    nodeMeshes = new Map<string, THREE.Mesh>();
    for (const node of allNodes(pageTree.nodesByLevel)) {
      const mesh = new THREE.Mesh(geometryForPhase1Node(node, sampler, config, params.debugMode), terrainMaterial);
      mesh.name = `phase1-${node.id}`;
      mesh.visible = false;
      nodeMeshes.set(node.id, mesh);
      scene.add(mesh);
    }
    buildMs = performance.now() - buildStart;
  } catch (error) {
    failLoud("Phase-1 terrain failed", failDetails(error));
    return;
  }

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, config.runtime.farViewM * 2);
  const flyCamera = new FlyCamera(camera, renderer.domElement);
  flyCamera.setPose(parseCamString(params.cam ?? DEFAULT_PHASE1_CAM) ?? parseCamString(DEFAULT_PHASE1_CAM)!);
  hooks.setPose = (pose) => flyCamera.setPose(pose);
  hooks.getPose = () => flyCamera.getPose();
  hooks.flyCamEnabled = (on) => { flyCamera.enabled = on; };

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
  stats.stats.counters["phase1.internalBorderChecks"] = pageTree.internalBorderChecks;
  stats.stats.counters["phase1.selectionErrorThresholdPx100"] = Math.round(config.selection.errorThresholdPx * 100);
  stats.stats.counters["phase1.selectionHysteresis100"] = Math.round(config.selection.hysteresisMergeFactor * 100);
  stats.stats.counters["phase1.buildMs100"] = Math.round(buildMs * 100);
  stats.stats.counters["phase1.debugMode"] = config.debug.modes.indexOf(params.debugMode);

  const hud = await import("../ui/hud.js").then(({ Hud }) => new Hud(stats.stats, {
    seed: params.seed, scene: "phase1-terrain", cam: params.cam,
    hud: params.hud, freeze: params.freeze, dpr: params.dpr,
    renderer: "webgpu", shot: null,
  }, camera));

  const surf = new SurfBand({
    config: coastConfig, seed: params.seed,
    cellSizeM: coastConfig.deep_ocean.near_grid_size_m / coastConfig.deep_ocean.near_subdivisions,
    verticalOffsetM: Math.max(0.01, coastConfig.surf.shore_wave_height * 0.1),
  });
  scene.add(surf.object);
  const deepOcean = new DeepOcean({ config: coastConfig, sunDirection, seed: params.seed });
  scene.add(deepOcean.object);

  const pageBoundaryGroup = new THREE.Group();
  pageBoundaryGroup.name = "phase1-page-boundaries";
  pageBoundaryGroup.visible = false;
  scene.add(pageBoundaryGroup);
  const lockedBorderGroup = new THREE.Group();
  lockedBorderGroup.name = "phase1-locked-border-vertices";
  lockedBorderGroup.visible = false;
  scene.add(lockedBorderGroup);

  const mutableState: Phase1MutableState = {
    selectionState: { split: new Set() },
    lastRendered: new Set<string>(),
    lastRenderedNodes: [],
    freezeLodSelection: coastConfig.debug.freeze_lod_selection,
    currentDebugMode: params.debugMode,
    rebuildInProgress: false,
    nodeMeshes,
    pageTree,
    sampler,
    terrainMaterial,
    heightfield,
    buildMs,
  };

  const staticDeps: Phase1StaticDeps = { config, params, coastConfig, scene, stats, surf, deepOcean, pageBoundaryGroup, lockedBorderGroup };
  const terrainActions = createTerrainActions(staticDeps, mutableState);

  const gui = new GUI({ title: "Border coast + ocean" });
  const { borderDebug, pageInputDebug, oceanDebug } = setupPhase1Gui({
    gui, sceneParams: params, coastConfig, scene, seed: params.seed,
    surf, deepOcean, pageBoundaryGroup, lockedBorderGroup,
    state: mutableState, actions: terrainActions,
  });

  const settleManager = createSettleManager(hooks, PHASE0.settleReadyFrames);

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  updateProgress(0.92, "phase1: starting runtime");
  const animate = createPhase1AnimationLoop({
    renderer, scene, camera, flyCamera, params, config, stats, hud,
    surf, deepOcean, borderDebug, pageInputDebug, oceanDebug,
    settleManager, state: mutableState, actions: terrainActions,
    coastConfig,
  });
  renderer.setAnimationLoop(animate);
}
