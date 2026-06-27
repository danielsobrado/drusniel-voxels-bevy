import * as THREE from "three";
import type { TerrainSummaryField } from "../clod/terrain_summary.js";
import { createExtendedCanopyTexture, createExtendedHeightTexture } from "../clod/terrain_summary.js";
import { buildFarCanopyShell } from "../gpu/far_canopy_shell.js";
import { buildFarTerrainShell, type FarHeightProvider } from "../gpu/far_terrain_shell.js";
import { FAR_SHELL_DEFAULTS } from "../app/clod_constants.js";
import type { EnvironmentLighting } from "../environment/environment.js";
import { updateFarTerrainMaterialCenter } from "../farTerrain/farTerrainMaterial.js";

export interface FarShellInstance {
  mesh: THREE.Mesh;
  triangleCount: number;
  dispose: () => void;
}

export interface FarShellUiSettings {
  enabled: boolean;
  radiusFactor: number;
  heightBias: number;
  heightDrop: number;
}

export interface FarShellControllerDeps {
  scene: THREE.Scene;
  terrainSummary: TerrainSummaryField;
  worldSizeCells: number;
  isLongView: boolean;
  queryFarShell: boolean;
  queryCanopy: boolean;
  getLighting: () => EnvironmentLighting;
  getSettings: () => FarShellUiSettings;
  onTriangleCount?: (counter: "far_shell_tris" | "canopy_tris", count: number) => void;
  receiveSunShadows?: () => boolean;
  useDebugLambertReceiver?: () => boolean;
  useParityMaterial?: () => boolean;
  getParityConfig?: () => import("../farTerrain/farTerrainUniforms.js").FarTerrainUniformData | undefined;
  heightProvider?: FarHeightProvider;
  centerX?: number;
  centerZ?: number;
  cameraRelativeInnerRadiusM?: number;
  requireCameraRelativeInnerRadius?: boolean;
  farShellRadiusM?: number;
  skipLegacyCanopy?: boolean;
}

export interface FarShellController {
  rebuild(): void;
  setEnabled(on: boolean): void;
  isBuilt(): boolean;
  readonly canopyShell: FarShellInstance | null;
  dispose(): void;
  moveTo(x: number, z: number): void;
  setHeightProvider(provider: FarHeightProvider | undefined): void;
  setFarRadiusOverride(m: number): void;
}

export function createFarShellController(deps: FarShellControllerDeps): FarShellController {
  let current: FarShellInstance | null = null;
  let canopyShell: FarShellInstance | null = null;
  let currentCenterX = deps.centerX ?? deps.worldSizeCells / 2;
  let currentCenterZ = deps.centerZ ?? deps.worldSizeCells / 2;
  let currentHeightProvider = deps.heightProvider;
  let currentFarRadiusOverride: number | undefined = deps.farShellRadiusM;
  let buildCenterX = currentCenterX;
  let buildCenterZ = currentCenterZ;

  const parityMaterialEnabled = (): boolean => Boolean(deps.useParityMaterial?.() && deps.getParityConfig?.());

  const syncParityMaterialCenter = (mesh: THREE.Mesh, x: number, z: number): void => {
    if (!parityMaterialEnabled()) return;
    if (Array.isArray(mesh.material)) return;
    updateFarTerrainMaterialCenter(mesh.material as import("three/webgpu").MeshBasicNodeMaterial, x, z);
  };

  const resolveFarRadius = (radiusFactor: number): number =>
    currentFarRadiusOverride && currentFarRadiusOverride > 0
      ? currentFarRadiusOverride
      : deps.farShellRadiusM && deps.farShellRadiusM > 0
        ? deps.farShellRadiusM
        : deps.worldSizeCells * radiusFactor;

  const resolveInnerExclusionRadius = (farRadius: number): number | undefined => {
    if (!currentHeightProvider) return undefined;
    const configured = deps.cameraRelativeInnerRadiusM;
    if (deps.requireCameraRelativeInnerRadius && (!configured || configured <= 0)) {
      throw new Error("Missing camera-relative far shell inner radius");
    }
    const fallback = deps.worldSizeCells / 2;
    const radius = configured && configured > 0 ? configured : fallback;
    return Math.max(0, Math.min(radius, farRadius * 0.95));
  };

  const buildFarShellInstance = (
    radiusFactor: number,
    heightBias: number,
    heightDrop: number,
    useRelativeBuild: boolean,
  ): FarShellInstance => {
    if (current) {
      deps.scene.remove(current.mesh);
      current.dispose();
    }
    const lighting = deps.getLighting();
    const farRadius = resolveFarRadius(radiusFactor);
    const result = buildFarTerrainShell(deps.terrainSummary, {
      sunDirection: lighting.sunDirection,
      sunColor: lighting.sunColor,
      skyLight: lighting.skyLight,
      groundLight: lighting.groundLight,
    }, {
      farRadius,
      gridRes: 128,
      heightDrop,
      heightBias,
      heightProvider: currentHeightProvider,
      centerX: currentCenterX,
      centerZ: currentCenterZ,
      innerExclusionRadius: resolveInnerExclusionRadius(farRadius),
      buildRelative: useRelativeBuild,
      receiveSunShadows: deps.receiveSunShadows?.() ?? false,
      useDebugLambertReceiver: deps.useDebugLambertReceiver?.() ?? false,
      useParityMaterial: parityMaterialEnabled(),
      parityConfig: deps.getParityConfig?.(),
    });
    buildCenterX = result.buildCenterX;
    buildCenterZ = result.buildCenterZ;
    if (useRelativeBuild) {
      result.mesh.position.set(currentCenterX, 0, currentCenterZ);
      syncParityMaterialCenter(result.mesh, currentCenterX, currentCenterZ);
    }
    current = result;
    deps.scene.add(result.mesh);
    deps.onTriangleCount?.("far_shell_tris", result.triangleCount);
    return result;
  };

  const rebuild = () => {
    const settings = deps.getSettings();
    const useRelative = currentHeightProvider !== undefined;
    buildFarShellInstance(settings.radiusFactor, settings.heightBias, settings.heightDrop, useRelative);
    if (!settings.enabled && !deps.isLongView) {
      if (current) deps.scene.remove(current.mesh);
    }
  };

  const moveTo = (x: number, z: number) => {
    if (!current) return;
    current.mesh.position.set(x - buildCenterX, 0, z - buildCenterZ);
    syncParityMaterialCenter(current.mesh, x, z);
    currentCenterX = x;
    currentCenterZ = z;
  };

  const initialSettings = deps.getSettings();
  current = buildFarShellInstance(
    initialSettings.radiusFactor,
    initialSettings.heightBias,
    initialSettings.heightDrop,
    currentHeightProvider !== undefined,
  );
  if (!initialSettings.enabled && !deps.isLongView && !deps.queryFarShell) {
    deps.scene.remove(current.mesh);
  }

  const canopyFarRadius = deps.worldSizeCells * FAR_SHELL_DEFAULTS.radiusFactor;
  if ((deps.isLongView || deps.queryCanopy) && !deps.skipLegacyCanopy) {
    const canopyHeightTexture = createExtendedHeightTexture(deps.terrainSummary, canopyFarRadius);
    const canopyCoverageTexture = createExtendedCanopyTexture(deps.terrainSummary, canopyFarRadius, 42);
    const lighting = deps.getLighting();
    canopyShell = buildFarCanopyShell(canopyHeightTexture, canopyCoverageTexture, deps.worldSizeCells, {
      sunDirection: lighting.sunDirection,
      sunColor: lighting.sunColor,
      skyLight: lighting.skyLight,
      groundLight: lighting.groundLight,
    }, {
      grid: 256,
      farRadius: canopyFarRadius,
    });
    deps.scene.add(canopyShell.mesh);
    deps.onTriangleCount?.("canopy_tris", canopyShell.triangleCount);
  }

  return {
    rebuild,
    setHeightProvider(provider: FarHeightProvider | undefined) {
      currentHeightProvider = provider;
      rebuild();
    },
    setFarRadiusOverride(m: number) {
      currentFarRadiusOverride = m > 0 ? m : undefined;
      rebuild();
    },
    setEnabled(on) {
      if (!current) return;
      if (on) deps.scene.add(current.mesh);
      else deps.scene.remove(current.mesh);
    },
    isBuilt() {
      return current !== null;
    },
    get canopyShell() {
      return canopyShell;
    },
    moveTo,
    dispose() {
      if (current) {
        deps.scene.remove(current.mesh);
        current.dispose();
        current = null;
      }
      if (canopyShell) {
        deps.scene.remove(canopyShell.mesh);
        canopyShell.dispose();
        canopyShell = null;
      }
    },
  };
}
