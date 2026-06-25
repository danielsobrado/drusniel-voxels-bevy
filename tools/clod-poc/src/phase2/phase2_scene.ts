import * as THREE from "three";
import GUI from "lil-gui";
import { FlyCamera } from "../core/fly_camera.js";
import { initHooks } from "../core/hooks.js";
import { createClodRuntime, advanceClodRuntime } from "../clod/runtime/clodRuntime.js";
import { createClodDitherMaterial } from "../clod/runtime/clodDitherMaterial.js";
import type { ClodRuntimeConfig } from "../clod/runtime/clodRuntimeTypes.js";
import { createClodDebugGui } from "../clod/debug/clodDebugGui.js";
import { ClodWireframeOverlay } from "../clod/debug/clodWireframeOverlay.js";
import { ClodPageBoundaryOverlay } from "../clod/debug/clodPageBoundaryOverlay.js";
import { ClodLockedBorderOverlay } from "../clod/debug/clodLockedBorderOverlay.js";
import { ClodErrorLabelOverlay } from "../clod/debug/clodErrorLabelOverlay.js";
import { ClodStatsPanel } from "../clod/debug/clodStatsPanel.js";
import { buildStressScene, type StressSceneResult } from "../clod/stress/clodStressRunner.js";
import {
  setStressTerrainDebugMode,
  type StressTerrainDebugMode,
} from "../clod/stress/stressTerrainFactory.js";
import { STRESS_SCENE_NAMES, type StressSceneName, type StressSceneParams, DEFAULT_STRESS_PARAMS } from "../clod/stress/stressSceneConfig.js";
import { logger } from "../clod/runtime/clodLogger.js";
import configYaml from "../../config/clod_pages.yaml?raw";
import { parseConfig, type ClodPagesConfig } from "../config.js";

function hideNormalAppChrome(): void {
  for (const id of ["clod-left-stack", "project-toolbar", "player-mode-bar", "terraform-menu", "build-progress", "crosshair"]) {
    const el = document.getElementById(id);
    if (el) {
      el.setAttribute("hidden", "");
      el.style.display = "none";
    }
  }
}

function intParam(q: URLSearchParams, key: string, fallback: number): number {
  const raw = q.get(key);
  if (raw === null) return fallback;
  const v = Number(raw);
  return Number.isInteger(v) && v > 0 ? v : fallback;
}

export async function runPhase2Scene(): Promise<void> {
  hideNormalAppChrome();
  const hooks = initHooks();
  const q = new URLSearchParams(window.location.search);

  let parsedConfig: ClodPagesConfig;
  try {
    parsedConfig = parseConfig(configYaml);
  } catch (e) {
    logger.error("Failed to parse config", e);
    return;
  }

  const cfg: ClodRuntimeConfig = {
    selection: {
      errorThresholdPx: parsedConfig.selection.error_threshold_px,
      hysteresisMergeFactor: parsedConfig.selection.hysteresis_merge_factor,
      neighborLevelDeltaMax: parsedConfig.selection.neighbor_level_delta_max,
    },
    crossfadeFrames: parsedConfig.selection.crossfade_frames,
    debug: {
      showWireframe: parsedConfig.debug.show_wireframe,
      showPageBoundaries: parsedConfig.debug.show_page_boundaries,
      showLockedBorderVertices: parsedConfig.debug.show_locked_border_vertices,
      showErrorLabels: parsedConfig.debug.show_error_labels,
      showStatsPanel: parsedConfig.debug.show_stats_panel,
      lodColors: parsedConfig.debug.lod_colors,
    },
    nearField: {
      enabled: parsedConfig.near_field.enabled,
      radiusChunks: parsedConfig.near_field.radius_chunks,
      showMask: parsedConfig.near_field.show_mask,
    },
  };

  const worldPages = intParam(q, "world", 4);
  const stressSceneParam: StressSceneName = (q.get("stressScene") as StressSceneName) ?? "ridge_border";

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);

  const hemi = new THREE.HemisphereLight(0x87ceeb, 0x3b2a1e, 0.7);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffeedd, 1.8);
  sun.position.set(800, 1200, 600);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 20000);
  const flyCam = new FlyCamera(camera, renderer.domElement);
  flyCam.setPose({ p: [64, 40, 128], yaw: -Math.PI * 0.75, pitch: -0.3, fov: 55 });
  hooks.setPose = (pose) => flyCam.setPose(pose);
  hooks.getPose = () => flyCam.getPose();
  hooks.flyCamEnabled = (on) => { flyCam.enabled = on; };

  const stressParams: StressSceneParams = {
    ...DEFAULT_STRESS_PARAMS,
    sceneName: stressSceneParam,
    lod0PagesX: worldPages,
    lod0PagesZ: worldPages,
  };

  let currentBuild: StressSceneResult;
  try {
    currentBuild = buildStressScene(stressSceneParam, scene, stressParams);
  } catch (e) {
    logger.error("Failed to build stress scene", e);
    return;
  }

  const runtimeState = createClodRuntime(cfg);
  runtimeState.stats.errorThresholdPx = cfg.selection.errorThresholdPx;

  for (const [, node] of currentBuild.nodes) {
    if (node.mesh) {
      const triCount = node.mesh.geometry.index
        ? node.mesh.geometry.index.count / 3
        : 0;
      runtimeState.nodeMeshMap.meshes.set(node.id, node.mesh);
      runtimeState.nodeMeshMap.ditherMaterials.set(
        node.id,
        createClodDitherMaterial(node.mesh.material as THREE.Material),
      );
      runtimeState.nodeTriangleCounts.set(node.id, triCount);
    }
  }

  const wireframeOverlay = new ClodWireframeOverlay(scene, cfg.debug.lodColors);
  const boundaryOverlay = new ClodPageBoundaryOverlay(scene);
  const lockedBorderOverlay = new ClodLockedBorderOverlay(scene);
  const errorLabelOverlay = new ClodErrorLabelOverlay(document.body);
  const statsPanel = new ClodStatsPanel(document.body);

  wireframeOverlay.setVisible(cfg.debug.showWireframe);
  boundaryOverlay.setVisible(cfg.debug.showPageBoundaries);
  lockedBorderOverlay.setVisible(cfg.debug.showLockedBorderVertices);
  errorLabelOverlay.setVisible(cfg.debug.showErrorLabels);
  statsPanel.setVisible(cfg.debug.showStatsPanel);

  const gui = new GUI({ title: "CLOD Phase 2" });
  const coastDebug = { mode: "final" as StressTerrainDebugMode };
  gui.add(coastDebug, "mode", [
    "final",
    "lod",
    "coastType",
    "materialWeights",
    "pageSourceSections",
  ]).name("coast debug").onChange((mode: StressTerrainDebugMode) => {
    setStressTerrainDebugMode(currentBuild, mode);
  });

  const guiState = createClodDebugGui(
    gui,
    runtimeState,
    cfg,
    [...STRESS_SCENE_NAMES],
    (sceneName: string) => {
      rebuildScene(sceneName as StressSceneName);
    },
    {
      setWireframeVisible: (v) => wireframeOverlay.setVisible(v),
      setPageBoundariesVisible: (v) => boundaryOverlay.setVisible(v),
      setLockedBorderVisible: (v) => lockedBorderOverlay.setVisible(v),
      setErrorLabelsVisible: (v) => errorLabelOverlay.setVisible(v),
      setStatsPanelVisible: (v) => statsPanel.setVisible(v),
      setNearFieldMaskVisible: (_v) => { /* near-field mask */ },
    },
  );

  let prevTimestamp = performance.now();

  function rebuildScene(sceneName: StressSceneName): void {
    runtimeState.nodeMeshMap.meshes.clear();
    runtimeState.nodeTriangleCounts.clear();

    for (const [, node] of currentBuild.nodes) {
      if (node.mesh) {
        scene.remove(node.mesh);
        node.mesh.geometry.dispose();
        if (Array.isArray(node.mesh.material)) {
          node.mesh.material.forEach((m) => m.dispose());
        } else {
          node.mesh.material.dispose();
        }
      }
    }
    wireframeOverlay.clear();
    boundaryOverlay.clear();

    try {
      currentBuild = buildStressScene(sceneName, scene, {
        ...stressParams,
        sceneName,
      });
      setStressTerrainDebugMode(currentBuild, coastDebug.mode);
      for (const [, node] of currentBuild.nodes) {
        if (node.mesh) {
          const triCount = node.mesh.geometry.index
            ? node.mesh.geometry.index.count / 3
            : 0;
          runtimeState.nodeMeshMap.meshes.set(node.id, node.mesh);
          runtimeState.nodeMeshMap.ditherMaterials.set(
            node.id,
            createClodDitherMaterial(node.mesh.material as THREE.Material),
          );
          runtimeState.nodeTriangleCounts.set(node.id, triCount);
        }
      }
      runtimeState.previousCut = null;
      logger.info(`switched to scene: ${sceneName}`);
    } catch (e) {
      logger.error("Failed to rebuild scene", e);
    }
  }

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const settleWaiters: { frames: number; resolve: () => void }[] = [];
  hooks.settle = (frames = 8) => new Promise((resolve) => settleWaiters.push({ frames, resolve }));

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.max(0.0001, Math.min((now - prevTimestamp) / 1000, 0.1));
    prevTimestamp = now;

    flyCam.update(dt); // camera always moves; freezeCut only freezes the CLOD cut

    if (guiState.enableRuntime) {
      advanceClodRuntime(runtimeState, {
        rootNodeIds: currentBuild.rootNodeIds,
        nodes: currentBuild.nodes,
        camera,
        viewportHeightPx: renderer.domElement.height,
      });
    }

    const cut = runtimeState.previousCut ?? { frame: 0, nodes: new Map() };
    wireframeOverlay.update(cut, currentBuild.nodes);
    boundaryOverlay.update(cut, currentBuild.nodes);
    lockedBorderOverlay.update(cut, currentBuild.nodes);
    errorLabelOverlay.update(cut, currentBuild.nodes, camera, renderer.domElement.height);
    statsPanel.update(runtimeState.stats);

    renderer.render(scene, camera);

    for (const w of settleWaiters) w.frames -= 1;
    const done = settleWaiters.filter((w) => w.frames <= 0);
    for (const w of done) w.resolve();
    for (const w of done) settleWaiters.splice(settleWaiters.indexOf(w), 1);

    if (!hooks.ready && runtimeState.frame >= 120) {
      hooks.ready = true;
    }
  });
}
