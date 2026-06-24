import * as THREE from "three";
import type { TerrainSummaryField } from "../clod/terrain_summary.js";
import { createExtendedCanopyTexture, createExtendedHeightTexture } from "../clod/terrain_summary.js";
import { buildFarCanopyShell } from "../gpu/far_canopy_shell.js";
import { buildFarTerrainShell } from "../gpu/far_terrain_shell.js";
import type { EnvironmentLighting } from "../environment.js";

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
}

export interface FarShellController {
  rebuild(): void;
  setEnabled(on: boolean): void;
  isBuilt(): boolean;
  readonly canopyShell: FarShellInstance | null;
  dispose(): void;
}

export function createFarShellController(deps: FarShellControllerDeps): FarShellController {
  let current: FarShellInstance | null = null;
  let canopyShell: FarShellInstance | null = null;

  const buildFarShellInstance = (
    radiusFactor: number,
    heightBias: number,
    heightDrop: number,
  ): FarShellInstance => {
    if (current) {
      deps.scene.remove(current.mesh);
      current.dispose();
    }
    const lighting = deps.getLighting();
    const result = buildFarTerrainShell(deps.terrainSummary, {
      sunDirection: lighting.sunDirection,
      sunColor: lighting.sunColor,
      skyLight: lighting.skyLight,
      groundLight: lighting.groundLight,
    }, {
      farRadius: deps.worldSizeCells * radiusFactor,
      gridRes: 128,
      heightDrop,
      heightBias,
    });
    current = result;
    deps.scene.add(result.mesh);
    deps.onTriangleCount?.("far_shell_tris", result.triangleCount);
    return result;
  };

  const rebuild = () => {
    const settings = deps.getSettings();
    buildFarShellInstance(settings.radiusFactor, settings.heightBias, settings.heightDrop);
    if (!settings.enabled && !deps.isLongView) {
      if (current) deps.scene.remove(current.mesh);
    }
  };

  current = buildFarShellInstance(1.5, 0.6, 2);
  if (!deps.isLongView && !deps.queryFarShell) {
    deps.scene.remove(current.mesh);
  }

  const canopyFarRadius = deps.worldSizeCells * 1.5;
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
