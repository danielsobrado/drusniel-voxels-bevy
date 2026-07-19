import * as THREE from "three";
import { WATER_DEBUG_MODES, type WaterDebugState, type ShoreSurfBandSettings } from "../../water/index.js";
import type { WaterField } from "../../water/index.js";
import type { WaterClipmap } from "../../water/index.js";
import { getWaterFoamRuntimeDiagnostics } from "../../water/water_foam_diagnostics.js";
import type { RiverCascadeParticleOverlay } from "../../water/riverCascadeParticleOverlay.js";
import type { WaterDebugPoseHooks, WaterControllerDeps } from "./water_controller_types.js";

export function installWaterDebugApi(
  deps: WaterControllerDeps,
  field: WaterField,
  clipmap: WaterClipmap,
  cascadeParticles: RiverCascadeParticleOverlay,
  debugState: WaterDebugState,
  applyShoreSurfDebugState: () => void,
  hooks: WaterDebugPoseHooks,
): void {
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
    debugState.shoreSurfEnabled = settings.enabled ?? debugState.shoreSurfEnabled;
    debugState.shoreSurfStartDistance = settings.startDistance ?? debugState.shoreSurfStartDistance;
    debugState.shoreSurfFullDistance = settings.fullSurfDistance ?? settings.fullDepthDistance ?? debugState.shoreSurfFullDistance;
    debugState.shoreSurfMaxDepth = settings.maxShallowDepth ?? settings.maxDepth ?? debugState.shoreSurfMaxDepth;
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
    cascadeParticles.update(0, deps.camera.position as THREE.Vector3);
    hooks.updateSelection();
    return {
      position: [(deps.camera.position as THREE.Vector3).x, (deps.camera.position as THREE.Vector3).y, (deps.camera.position as THREE.Vector3).z],
      target: [x, targetY, z],
      yaw,
    };
  };
  const setWaterFoamSunVisibilityOverride = async (value?: number | null) => {
    const visibility = value === undefined || value === null ? null : Number(value);
    if (visibility !== null && !Number.isFinite(visibility)) {
      throw new Error("foam sun visibility override must be finite or null");
    }
    const { setSunLightGpuAtlasDebugOverride } = await import(
      "../../terrain/sun_visibility/sun_light_gpu_atlas_nodes.js"
    );
    return setSunLightGpuAtlasDebugOverride(visibility);
  };
  const waterDebugInfo = () => {
    const uiState = deps.getUiState();
    return {
      worldCells: deps.worldCells,
      enabled: clipmap.isEnabled,
      rendererBackend: deps.isWebGpu ? "webgpu" : "webgl",
      debugMode: uiState.waterDebugMode,
      clipmapTint: uiState.waterClipmapTint,
      wireframe: uiState.waterWireframe,
      shoreSurf: field.getShoreSurfBand(),
      clipmapExclusionBand: field.getClipmapExclusionBand(),
      debugModes: { ...WATER_DEBUG_MODES },
      foam: getWaterFoamRuntimeDiagnostics(deps.searchParams),
      residueOverlay: true,
      cascadeParticles: cascadeParticles.getStats(),
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
    setCameraPose,
    setWaterFoamSunVisibilityOverride,
    waterDebugInfo,
  });
}

export function logWaterDevInit(
  clipmap: WaterClipmap,
  deps: WaterControllerDeps,
  field: WaterField,
  cascadeParticles: RiverCascadeParticleOverlay,
  devLogged: { value: boolean },
): void {
  if (devLogged.value) return;
  devLogged.value = true;
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
    worldCells: deps.worldCells,
    worldBounds: { minX: 0, minZ: 0, maxX: deps.worldCells, maxZ: deps.worldCells },
    shoreSurf: field.getShoreSurfBand(),
    clipmapExclusionBand: field.getClipmapExclusionBand(),
    cascadeParticles: cascadeParticles.getStats(),
    resolvedLakes: deps.waterConfig.fakeBodies.lakes.map((l) => ({ center: l.center, radius: l.radius, levelOffset: l.levelOffset })),
    resolvedRivers: deps.waterConfig.fakeBodies.rivers.map((r) => r.points),
    lakeCenterSample: lakeCenterSample ? {
      terrainY: lakeCenterSample.terrainY, waterY: lakeCenterSample.waterY,
      depth: lakeCenterSample.depth, bodyMask: lakeCenterSample.bodyMask,
    } : null,
    riverMidpointSample: riverMidSample ? {
      terrainY: riverMidSample.terrainY, waterY: riverMidSample.waterY,
      depth: riverMidSample.depth, bodyMask: riverMidSample.bodyMask,
    } : null,
    firstLevelRect: rect ? { minX: rect.minX, minZ: rect.minZ, maxX: rect.maxX, maxZ: rect.maxZ } : null,
  });
}
