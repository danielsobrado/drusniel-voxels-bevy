import * as THREE from "three";
import type { ClodPageNode } from "../../types.js";
import { assertPageMeshSignaturesUnchanged, pageMeshSignatures } from "../../stones/stone_validation.js";
import type { BorderCoastOceanConfig } from "../../terrain/border_coast_config.js";
import {
  DEFAULT_SHORE_SURF_BAND_SETTINGS,
  WaterClipmap,
  WaterField,
  WATER_DEBUG_MODES,
  type ShoreSurfBandSettings,
  type WaterConfig,
  type WaterDebugState,
} from "../../water/index.js";
import { defaultWaterDebugState } from "../../water/waterDebug.js";
import type { HydrologySystem } from "../../water/hydrologySystem.js";
import { createWaterShaderMaterial } from "../../water/waterMaterial.js";

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
  borderCoastOceanConfig?: BorderCoastOceanConfig;
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
  setOceanEnabled(enabled: boolean): void;
  setOceanStartDistance(distance: number): void;
  setOceanFullDepthDistance(distance: number): void;
  setOceanMaxDepth(depth: number): void;
  updateVisual(visual: ReturnType<WaterController["makeVisual"]>): void;
  updateSunDirection(direction: THREE.Vector3): void;
  update(deltaSeconds: number, cameraPosition: THREE.Vector3): void;
  installDebugApi(hooks: WaterDebugPoseHooks): void;
  logDevInitOnce(worldCells: number): void;
  dispose(): void;
}

function readPositiveParam(searchParams: URLSearchParams, key: string, fallback: number): number {
  const raw = searchParams.get(key);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readShoreSurfSettings(
  searchParams: URLSearchParams,
  borderCoast?: BorderCoastOceanConfig,
): ShoreSurfBandSettings {
  const fromBorder = borderCoast?.enabled
    ? {
        enabled: true,
        startDistance: borderCoast.coast.oceanStartCells,
        fullSurfDistance: borderCoast.coast.oceanFullDepthCells,
        level: borderCoast.ocean.surfaceY,
        maxShallowDepth: Math.min(2.5, borderCoast.ocean.minDepth),
      }
    : {};
  const deepOceanOwnsBorder = Boolean(borderCoast?.enabled && borderCoast.deepOcean.enabled);
  const urlEnabled = searchParams.get("shoreSurf") === "1" || searchParams.get("edgeOcean") === "1";
  const urlDisabled = searchParams.get("shoreSurf") === "0" || searchParams.get("edgeOcean") === "0";
  const legacySurfEnabled = Boolean(fromBorder.enabled) && !deepOceanOwnsBorder;
  return {
    ...DEFAULT_SHORE_SURF_BAND_SETTINGS,
    ...fromBorder,
    enabled: !urlDisabled && (urlEnabled || legacySurfEnabled),
    startDistance: readPositiveParam(
      searchParams,
      "oceanStart",
      fromBorder.startDistance ?? DEFAULT_SHORE_SURF_BAND_SETTINGS.startDistance,
    ),
    fullSurfDistance: readPositiveParam(
      searchParams,
      "oceanFull",
      fromBorder.fullSurfDistance ?? DEFAULT_SHORE_SURF_BAND_SETTINGS.fullSurfDistance,
    ),
    maxShallowDepth: readPositiveParam(
      searchParams,
      "surfDepth",
      fromBorder.maxShallowDepth ?? DEFAULT_SHORE_SURF_BAND_SETTINGS.maxShallowDepth,
    ),
  };
}

function deepOceanClipmapExclusionDistance(
  searchParams: URLSearchParams,
  borderCoast?: BorderCoastOceanConfig,
): number {
  if (searchParams.get("clipmapBorderWater") === "1") return 0;
  if (!borderCoast?.enabled || !borderCoast.deepOcean.enabled) return 0;
  return Math.max(0, borderCoast.coast.oceanStartCells);
}

export async function createWaterController(deps: WaterControllerDeps): Promise<WaterController> {
  const pageSignaturesBefore = pageMeshSignatures(deps.nodes);
  const field = new WaterField(deps.waterConfig, { surfaceHeight: deps.surfaceHeight }, deps.hydrologySystem, deps.worldCells);
  const shoreSurfSettings = readShoreSurfSettings(deps.searchParams, deps.borderCoastOceanConfig);
  const clipmapExclusionDistance = deepOceanClipmapExclusionDistance(deps.searchParams, deps.borderCoastOceanConfig);
  field.setShoreSurfBand(shoreSurfSettings);
  field.setClipmapExclusionBand({
    enabled: clipmapExclusionDistance > 0,
    distance: clipmapExclusionDistance,
  });
  const waterMaterialFactory = deps.isWebGpu
    ? (await import("../../water/waterNodeMaterial.js")).createWaterNodeMaterialImpl
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
    ...defaultWaterDebugState({
      ...deps.waterConfig.visual,
      depthWrite: ui.waterDepthWrite,
    }),
    enabled: ui.waterEnabled,
    mode: ui.waterDebugMode,
    clipmapTint: ui.waterClipmapTint,
    wireframe: ui.waterWireframe,
    depthWrite: ui.waterDepthWrite,
    oceanEnabled: shoreSurfSettings.enabled,
    oceanStartDistance: shoreSurfSettings.startDistance,
    oceanFullDepthDistance: shoreSurfSettings.fullSurfDistance,
    oceanMaxDepth: shoreSurfSettings.maxShallowDepth,
    riverSource: deps.waterConfig.source,
  };

  const makeVisual = () => ({
    ...deps.waterConfig.visual,
    depthWrite: deps.getUiState().waterDepthWrite,
  });

  const applyShoreSurfDebugState = () => {
    field.setShoreSurfBand({
      enabled: debugState.oceanEnabled,
      startDistance: debugState.oceanStartDistance,
      fullSurfDistance: debugState.oceanFullDepthDistance,
      maxShallowDepth: debugState.oceanMaxDepth,
    });
    clipmap.update(0, deps.camera.position as THREE.Vector3);
  };

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
    setOceanEnabled(enabled) {
      debugState.oceanEnabled = enabled;
      applyShoreSurfDebugState();
    },
    setOceanStartDistance(distance) {
      debugState.oceanStartDistance = Math.max(1, distance);
      applyShoreSurfDebugState();
    },
    setOceanFullDepthDistance(distance) {
      debugState.oceanFullDepthDistance = Math.max(0, distance);
      applyShoreSurfDebugState();
    },
    setOceanMaxDepth(depth) {
      debugState.oceanMaxDepth = Math.max(0.01, depth);
      applyShoreSurfDebugState();
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
      const setShoreSurfBand = (settings: Partial<ShoreSurfBandSettings & { fullDepthDistance?: number; maxDepth?: number }>) => {
        debugState.oceanEnabled = settings.enabled ?? debugState.oceanEnabled;
        debugState.oceanStartDistance = settings.startDistance ?? debugState.oceanStartDistance;
        debugState.oceanFullDepthDistance = settings.fullSurfDistance ?? settings.fullDepthDistance ?? debugState.oceanFullDepthDistance;
        debugState.oceanMaxDepth = settings.maxShallowDepth ?? settings.maxDepth ?? debugState.oceanMaxDepth;
        applyShoreSurfDebugState();
        return field.getShoreSurfBand();
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
          shoreSurf: field.getShoreSurfBand(),
          clipmapExclusionBand: field.getClipmapExclusionBand(),
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
        setShoreSurfBand,
        setEdgeOcean: setShoreSurfBand,
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
        shoreSurf: field.getShoreSurfBand(),
        clipmapExclusionBand: field.getClipmapExclusionBand(),
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
