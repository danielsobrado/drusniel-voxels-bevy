import * as THREE from "three";
import type { ClodPageNode } from "../types.js";
import { assertPageMeshSignaturesUnchanged, pageMeshSignatures } from "../stones/stone_validation.js";
import {
  WaterClipmap,
  WaterField,
  WATER_DEBUG_MODES,
  type WaterConfig,
  type WaterDebugState,
} from "../water/index.js";
import type { HydrologySystem } from "../water/hydrologySystem.js";
import { createWaterShaderMaterial } from "../water/waterMaterial.js";

export interface WaterControllerUiState {
  waterEnabled: boolean;
  waterDebugMode: keyof typeof WATER_DEBUG_MODES;
  waterClipmapTint: boolean;
  waterWireframe: boolean;
  waterDepthWrite: boolean;
}

export interface WaterDebugPoseHooks {
  exitToOrbit: () => void;
  resetPlayerInput: () => void;
  setControlsEnabled: (enabled: boolean) => void;
  setControlsTarget: (x: number, y: number, z: number) => void;
  setCameraPosition: (x: number, y: number, z: number) => void;
  cameraLookAt: (x: number, y: number, z: number) => void;
  controlsUpdate: () => void;
  updatePlayerModeUi: () => void;
  updateSelection: () => void;
  setWaterDebugModeState: (mode: keyof typeof WATER_DEBUG_MODES) => void;
}

export interface WaterControllerDeps {
  scene: THREE.Scene;
  nodes: ClodPageNode[];
  waterConfig: WaterConfig;
  worldCells: number;
  isWebGpu: boolean;
  surfaceHeight: (x: number, z: number) => number;
  hydrologySystem: HydrologySystem | null;
  camera: THREE.Camera;
  getSunDirection: () => THREE.Vector3;
  getUiState: () => WaterControllerUiState;
  searchParams: URLSearchParams;
  devMode: boolean;
}

export interface WaterController {
  readonly field: WaterField;
  readonly clipmap: WaterClipmap;
  readonly debugState: WaterDebugState;
  makeVisual(): { depthWrite: boolean } & WaterConfig["visual"];
  setVisible(enabled: boolean): void;
  setDebugMode(mode: keyof typeof WATER_DEBUG_MODES): void;
  setClipmapTint(enabled: boolean): void;
  setWireframe(enabled: boolean): void;
  updateVisual(visual: ReturnType<WaterController["makeVisual"]>): void;
  updateSunDirection(direction: THREE.Vector3): void;
  update(deltaSeconds: number, cameraPosition: THREE.Vector3): void;
  installDebugApi(hooks: WaterDebugPoseHooks): void;
  logDevInitOnce(worldCells: number): void;
  dispose(): void;
}

export async function createWaterController(deps: WaterControllerDeps): Promise<WaterController> {
  const pageSignaturesBefore = pageMeshSignatures(deps.nodes);
  const field = new WaterField(deps.waterConfig, { surfaceHeight: deps.surfaceHeight }, deps.hydrologySystem);
  const waterMaterialFactory = deps.isWebGpu
    ? (await import("../water/waterNodeMaterial.js")).createWaterNodeMaterialImpl
    : createWaterShaderMaterial;
  const clipmap = new WaterClipmap({
    scene: deps.scene,
    config: deps.waterConfig,
    field,
    createMaterial: waterMaterialFactory,
    sunDirection: deps.getSunDirection().clone(),
    cameraPosition: deps.camera.position as THREE.Vector3,
    worldBounds: { cellsX: deps.worldCells, cellsZ: deps.worldCells },
  });
  const ui = deps.getUiState();
  clipmap.setVisible(ui.waterEnabled);
  clipmap.setClipmapTint(ui.waterClipmapTint);
  clipmap.setWireframe(ui.waterWireframe);
  assertPageMeshSignaturesUnchanged(pageSignaturesBefore, pageMeshSignatures(deps.nodes));

  let devLogged = false;
  const debugState: WaterDebugState = {
    enabled: ui.waterEnabled,
    mode: ui.waterDebugMode,
    clipmapTint: ui.waterClipmapTint,
    wireframe: ui.waterWireframe,
    depthWrite: ui.waterDepthWrite,
  };

  const makeVisual = () => ({
    ...deps.waterConfig.visual,
    depthWrite: deps.getUiState().waterDepthWrite,
  });

  const controller: WaterController = {
    field,
    clipmap,
    debugState,
    makeVisual,
    setVisible(enabled) {
      clipmap.setVisible(enabled);
    },
    setDebugMode(mode) {
      clipmap.setDebugMode(WATER_DEBUG_MODES[mode]);
    },
    setClipmapTint(enabled) {
      clipmap.setClipmapTint(enabled);
    },
    setWireframe(enabled) {
      clipmap.setWireframe(enabled);
    },
    updateVisual(visual) {
      clipmap.updateVisual(visual);
    },
    updateSunDirection(direction) {
      clipmap.updateSunDirection(direction);
    },
    update(deltaSeconds, cameraPosition) {
      clipmap.update(deltaSeconds, cameraPosition);
    },
    installDebugApi(hooks) {
      const enabled = deps.devMode || deps.searchParams.get("waterDebug") === "1" || deps.searchParams.get("debug") === "1";
      if (!enabled) return;

      const sampleForDebug = (x: number, z: number) => {
        const s = field.sample(x, z);
        return {
          terrain: s.terrainY,
          water: s.waterY,
          depth: s.depth,
          flowX: s.flow.x,
          flowZ: s.flow.z,
          flowSpeed: s.flow.speed,
          flowProgress: s.flow.progress,
          flowDrop: s.flow.drop,
          bodyMask: s.bodyMask,
        };
      };
      const setWaterDebugMode = (mode: keyof typeof WATER_DEBUG_MODES | number) => {
        const id = typeof mode === "number" ? mode : WATER_DEBUG_MODES[mode];
        if (id === undefined || !Object.values(WATER_DEBUG_MODES).includes(id as typeof WATER_DEBUG_MODES[keyof typeof WATER_DEBUG_MODES])) {
          throw new Error(`unknown water debug mode: ${String(mode)}`);
        }
        const modeName = (Object.entries(WATER_DEBUG_MODES).find(([, v]) => v === id)?.[0] ?? "final") as keyof typeof WATER_DEBUG_MODES;
        hooks.setWaterDebugModeState(modeName);
        debugState.mode = modeName;
        clipmap.setDebugMode(id as typeof WATER_DEBUG_MODES[keyof typeof WATER_DEBUG_MODES]);
        return { mode: modeName, id };
      };
      const setCameraPose = (pose: { x: number; z: number; yaw?: number; y?: number; distance?: number; pitch?: number }) => {
        const x = Number(pose.x);
        const z = Number(pose.z);
        if (!Number.isFinite(x) || !Number.isFinite(z)) throw new Error("setCameraPose requires finite x and z");
        const yaw = Number.isFinite(pose.yaw) ? Number(pose.yaw) : 0;
        const targetY = field.sample(x, z).terrainY;
        const pitch = Number.isFinite(pose.pitch) ? Number(pose.pitch) : -0.35;
        const distance = Math.max(2, Number.isFinite(pose.distance) ? Number(pose.distance) : 26);
        const horizontal = Math.max(1, Math.cos(Math.abs(pitch)) * distance);
        const height = Math.max(3, Math.sin(Math.abs(pitch)) * distance);
        const dirX = Math.sin(yaw);
        const dirZ = -Math.cos(yaw);
        hooks.exitToOrbit();
        hooks.resetPlayerInput();
        hooks.setControlsEnabled(true);
        hooks.setControlsTarget(x, targetY, z);
        hooks.setCameraPosition(
          x - dirX * horizontal,
          Number.isFinite(pose.y) ? Number(pose.y) : targetY + height,
          z - dirZ * horizontal,
        );
        hooks.cameraLookAt(x, targetY, z);
        hooks.controlsUpdate();
        hooks.updatePlayerModeUi();
        clipmap.update(0, deps.camera.position as THREE.Vector3);
        hooks.updateSelection();
        return {
          position: [(deps.camera.position as THREE.Vector3).x, (deps.camera.position as THREE.Vector3).y, (deps.camera.position as THREE.Vector3).z],
          target: [x, targetY, z],
          yaw,
        };
      };
      const waterDebugInfo = () => {
        const uiState = deps.getUiState();
        return {
          worldCells: deps.worldCells,
          enabled: clipmap.isEnabled,
          debugMode: uiState.waterDebugMode,
          clipmapTint: uiState.waterClipmapTint,
          wireframe: uiState.waterWireframe,
          debugModes: { ...WATER_DEBUG_MODES },
          clipmap: {
            levelCount: clipmap.levelCount,
            levels: Array.from({ length: clipmap.levelCount }, (_, index) => clipmap.getLevelRect(index)),
          },
          fakeBodies: {
            lakes: deps.waterConfig.fakeBodies.lakes.map((lake) => ({
              center: [...lake.center],
              radius: [...lake.radius],
              levelOffset: lake.levelOffset,
            })),
            rivers: deps.waterConfig.fakeBodies.rivers.map((river) => ({
              points: river.points.map((point) => [...point]),
              width: river.width,
              levelOffset: river.levelOffset,
              downstreamDrop: river.downstreamDrop,
            })),
          },
        };
      };
      Object.assign(window, {
        waterProbe: sampleForDebug,
        setWaterDebugMode,
        setCameraPose,
        waterDebugInfo,
      });
    },
    logDevInitOnce(worldCells) {
      if (devLogged) return;
      devLogged = true;
      const rect = clipmap.getLevelRect(0);
      const firstLake = deps.waterConfig.fakeBodies.lakes[0];
      const lakeCenterSample = firstLake ? field.sample(firstLake.center[0], firstLake.center[1]) : null;
      const firstRiver = deps.waterConfig.fakeBodies.rivers[0];
      let riverMidSample = null;
      if (firstRiver && firstRiver.points.length >= 2) {
        const midIdx = Math.floor(firstRiver.points.length / 2);
        const p1 = firstRiver.points[midIdx - 1];
        const p2 = firstRiver.points[midIdx];
        const midX = (p1[0] + p2[0]) / 2;
        const midZ = (p1[1] + p2[1]) / 2;
        riverMidSample = field.sample(midX, midZ);
      }
      console.log("[DEV LOG] Water System Initialized:", {
        worldCells,
        worldBounds: { minX: 0, minZ: 0, maxX: worldCells, maxZ: worldCells },
        resolvedLakes: deps.waterConfig.fakeBodies.lakes.map((l) => ({ center: l.center, radius: l.radius, levelOffset: l.levelOffset })),
        resolvedRivers: deps.waterConfig.fakeBodies.rivers.map((r) => r.points),
        lakeCenterSample: lakeCenterSample ? {
          terrainY: lakeCenterSample.terrainY,
          waterY: lakeCenterSample.waterY,
          depth: lakeCenterSample.depth,
          bodyMask: lakeCenterSample.bodyMask,
        } : null,
        riverMidpointSample: riverMidSample ? {
          terrainY: riverMidSample.terrainY,
          waterY: riverMidSample.waterY,
          depth: riverMidSample.depth,
          bodyMask: riverMidSample.bodyMask,
        } : null,
        firstLevelRect: rect ? { minX: rect.minX, minZ: rect.minZ, maxX: rect.maxX, maxZ: rect.maxZ } : null,
      });
    },
    dispose() {
      clipmap.dispose();
    },
  };

  return controller;
}
