import * as THREE from "three";
import type { TerrainSummaryField } from "../clod/terrain_summary.js";
import { createExtendedCanopyTexture, createExtendedHeightTexture } from "../clod/terrain_summary.js";
import { buildFarCanopyShell } from "../gpu/far_canopy_shell.js";
import { buildFarTerrainShell, type FarHeightProvider } from "../gpu/far_terrain_shell.js";
import { FAR_SHELL_DEFAULTS } from "../app/clod_constants.js";
import type { EnvironmentLighting } from "../environment/environment.js";

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
  heightProvider?: FarHeightProvider;
  centerX?: number;
  centerZ?: number;
  /** Override the shell far radius in world units. When set, the shell radius is
   *  this value instead of worldSizeCells * radiusFactor. */
  farShellRadiusM?: number;
}

export interface FarShellController {
  rebuild(): void;
  setEnabled(on: boolean): void;
  isBuilt(): boolean;
  readonly canopyShell: FarShellInstance | null;
  dispose(): void;
  moveTo(x: number, z: number): void;
  /** Set or change the height provider after construction. Rebuilds the shell. */
  setHeightProvider(provider: FarHeightProvider | undefined): void;
  /** Override the shell far radius (world units). Pass 0 to clear the override. */
  setFarRadiusOverride(m: number): void;
}

export function createFarShellController(deps: FarShellControllerDeps): FarShellController {
  let current: FarShellInstance | null = null;
  let canopyShell: FarShellInstance | null = null;
  let currentCenterX = deps.centerX ?? deps.worldSizeCells / 2;
  let currentCenterZ = deps.centerZ ?? deps.worldSizeCells / 2;
  let currentHeightProvider = deps.heightProvider;
  let currentFarRadiusOverride = 0;
  let buildCenterX = currentCenterX;
  let buildCenterZ = currentCenterZ;

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
    const farRadius = currentFarRadiusOverride ?? deps.farShellRadiusM ?? deps.worldSizeCells * radiusFactor;
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
      buildRelative: useRelativeBuild,
    });
    buildCenterX = result.buildCenterX;
    buildCenterZ = result.buildCenterZ;
    // For relative build, translate to the actual world center
    if (useRelativeBuild) {
      result.mesh.position.set(currentCenterX, 0, currentCenterZ);
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
    // For relative builds, just translate the mesh.
    // For non-relative, delta-move (only valid for small offsets).
    current.mesh.position.set(x - buildCenterX, 0, z - buildCenterZ);
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
  if (deps.isLongView || deps.queryCanopy) {
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
      currentFarRadiusOverride = m;
      if (m > 0) rebuild();
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
