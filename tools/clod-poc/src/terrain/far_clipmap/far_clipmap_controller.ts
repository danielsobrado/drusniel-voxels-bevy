import * as THREE from "three";
import type { FarClipmapConfig, FarClipmapDebugMode } from "./far_clipmap_config.js";
import { farClipmapRingRange, farClipmapSnap } from "./far_clipmap_keys.js";
import {
  createFarClipmapGridGeometry,
  createFarClipmapTerrainGeometry,
} from "./far_clipmap_geometry.js";
import {
  createFarClipmapMaterial,
  farClipmapShaderRenderOrder,
  setFarClipmapMaterialDebugMode,
  updateFarClipmapMaterialFrameUniforms,
  type FarClipmapMaterial,
} from "./far_clipmap_material.js";
import type { FarClipmapSource } from "./far_clipmap_source.js";
import { createDefaultFarClipmapSource } from "./far_clipmap_source.js";

export interface FarClipmapStats {
  enabled: number;
  visible: number;
  ringCount: number;
  activeTiles: number;
  readyTiles: number;
  pendingTiles: number;
  rebuiltTilesThisFrame: number;
  innerRadiusM: number;
  outerRadiusM: number;
  snapSizeM: number;
  gpuOwnedCells: number;
  gpuOwnershipHoles: number;
  sourceReady: number;
  buildMsThisFrame: number;
  buildMsTotal: number;
  verticesBuiltThisFrame: number;
  trianglesBuiltThisFrame: number;
  fallbackSamplesThisFrame: number;
  fallbackSamplesTotal: number;
  exceptionSamplesThisFrame: number;
  exceptionSamplesTotal: number;
}

export interface FarClipmapOwnershipSnapshot {
  enabled: boolean;
  innerRadiusM: number;
  outerRadiusM: number;
  centerX: number;
  centerZ: number;
  snapX: number;
  snapZ: number;
  ready: boolean;
}

export interface FarClipmapControllerOptions {
  webGpuCompatibleMaterial?: boolean;
}

export interface FarClipmapController {
  update(cameraPosition: THREE.Vector3): FarClipmapStats;
  setDebugMode(mode: FarClipmapDebugMode): void;
  setVisible(visible: boolean): void;
  dispose(): void;
  ownershipSnapshot(): FarClipmapOwnershipSnapshot;
}

interface RingMesh {
  mesh: THREE.Mesh;
  material: FarClipmapMaterial;
  innerRadiusM: number;
  outerRadiusM: number;
  cellSizeM: number;
  readySnapX: number;
  readySnapZ: number;
}

interface BuildFrameStats {
  rebuilt: number;
  buildMs: number;
  vertices: number;
  triangles: number;
  fallbackSamples: number;
  exceptionSamples: number;
}

function emptyFrameStats(): BuildFrameStats {
  return {
    rebuilt: 0,
    buildMs: 0,
    vertices: 0,
    triangles: 0,
    fallbackSamples: 0,
    exceptionSamples: 0,
  };
}

function makeStats(
  config: FarClipmapConfig,
  visible: boolean,
  readyTiles: number,
  frameStats: BuildFrameStats,
  sourceReady: boolean,
  totals: { buildMs: number; fallbackSamples: number; exceptionSamples: number },
): FarClipmapStats {
  const pendingTiles = Math.max(0, config.ringCount - readyTiles);
  return {
    enabled: config.enabled ? 1 : 0,
    visible: visible && config.enabled ? 1 : 0,
    ringCount: config.ringCount,
    activeTiles: visible && config.enabled ? config.ringCount : 0,
    readyTiles,
    pendingTiles,
    rebuiltTilesThisFrame: frameStats.rebuilt,
    innerRadiusM: config.innerRadiusM,
    outerRadiusM: config.outerRadiusM,
    snapSizeM: config.snapSizeM,
    gpuOwnedCells: readyTiles,
    gpuOwnershipHoles: pendingTiles,
    sourceReady: sourceReady ? 1 : 0,
    buildMsThisFrame: frameStats.buildMs,
    buildMsTotal: totals.buildMs,
    verticesBuiltThisFrame: frameStats.vertices,
    trianglesBuiltThisFrame: frameStats.triangles,
    fallbackSamplesThisFrame: frameStats.fallbackSamples,
    fallbackSamplesTotal: totals.fallbackSamples,
    exceptionSamplesThisFrame: frameStats.exceptionSamples,
    exceptionSamplesTotal: totals.exceptionSamples,
  };
}

function ringCellSize(config: FarClipmapConfig, outerRadiusM: number): number {
  return (outerRadiusM * 2) / Math.max(1, config.gridResolution - 1);
}

function ringVertexCount(config: FarClipmapConfig): number {
  return config.gridResolution * config.gridResolution;
}

function ringTriangleCount(config: FarClipmapConfig): number {
  return Math.max(0, config.gridResolution - 1) * Math.max(0, config.gridResolution - 1) * 2;
}

export function createFarClipmapController(
  scene: THREE.Scene,
  config: FarClipmapConfig,
  source: FarClipmapSource = createDefaultFarClipmapSource(),
  options: FarClipmapControllerOptions = {},
): FarClipmapController {
  return new FarClipmapControllerImpl(scene, config, source, options);
}

class FarClipmapControllerImpl implements FarClipmapController {
  private readonly rings: RingMesh[] = [];
  private visible = true;
  private centerX = 0;
  private centerZ = 0;
  private snapX = Number.NaN;
  private snapZ = Number.NaN;
  private lastStats: FarClipmapStats;
  private totalBuildMs = 0;
  private totalFallbackSamples = 0;
  private totalExceptionSamples = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly config: FarClipmapConfig,
    private readonly source: FarClipmapSource,
    private readonly options: FarClipmapControllerOptions,
  ) {
    this.lastStats = makeStats(config, false, 0, emptyFrameStats(), false, {
      buildMs: 0,
      fallbackSamples: 0,
      exceptionSamples: 0,
    });
    for (let ring = 0; ring < config.ringCount; ring++) {
      const range = farClipmapRingRange(config, ring);
      const cellSizeM = ringCellSize(config, range.outerRadiusM);
      const material = createFarClipmapMaterial({
        debugMode: config.materialDebugMode,
        seaLevel: 0,
        clipInnerRadiusM: range.innerRadiusM,
        clipOuterRadiusM: range.outerRadiusM,
        cellSizeM,
        heightScale: config.heightScale,
        yOffset: config.yOffset,
        webGpuCompatible: options.webGpuCompatibleMaterial === true,
      });
      const mesh = new THREE.Mesh(createFarClipmapGridGeometry({ gridResolution: config.gridResolution }), material);
      mesh.name = "far-clipmap-ring-" + String(ring);
      mesh.frustumCulled = false;
      mesh.renderOrder = farClipmapShaderRenderOrder();
      mesh.visible = false;
      scene.add(mesh);
      this.rings.push({
        mesh,
        material,
        innerRadiusM: range.innerRadiusM,
        outerRadiusM: range.outerRadiusM,
        cellSizeM,
        readySnapX: Number.NaN,
        readySnapZ: Number.NaN,
      });
    }
  }

  update(cameraPosition: THREE.Vector3): FarClipmapStats {
    const frameStats = emptyFrameStats();
    const sourceReady = this.source.isReady?.() ?? true;
    if (!this.config.enabled) {
      this.lastStats = makeStats(this.config, false, 0, frameStats, sourceReady, this.totals());
      return this.lastStats;
    }
    this.centerX = cameraPosition.x;
    this.centerZ = cameraPosition.z;
    const snap = farClipmapSnap(cameraPosition.x, cameraPosition.z, this.config.snapSizeM);
    this.snapX = snap.snapX;
    this.snapZ = snap.snapZ;
    let ready = 0;
    const vertexCount = ringVertexCount(this.config);
    const triangleCount = ringTriangleCount(this.config);
    for (const ring of this.rings) {
      const stale = ring.readySnapX !== snap.snapX || ring.readySnapZ !== snap.snapZ;
      if (stale && sourceReady && frameStats.rebuilt < this.config.maxRebuildsPerFrame) {
        const startedAt = performance.now();
        ring.readySnapX = snap.snapX;
        ring.readySnapZ = snap.snapZ;
        frameStats.rebuilt++;

        if (this.options.webGpuCompatibleMaterial === true) {
          const oldGeo = ring.mesh.geometry;
          const newGeo = createFarClipmapTerrainGeometry({
            gridResolution: this.config.gridResolution,
            centerX: snap.snapX,
            centerZ: snap.snapZ,
            innerRadiusM: ring.innerRadiusM,
            outerRadiusM: ring.outerRadiusM,
            heightScale: this.config.heightScale,
            yOffset: this.config.yOffset,
            source: this.source,
          });
          ring.mesh.geometry = newGeo;
          oldGeo.dispose();
        }

        frameStats.vertices += vertexCount;
        frameStats.triangles += triangleCount;
        const buildMs = performance.now() - startedAt;
        frameStats.buildMs += buildMs;
        this.totalBuildMs += buildMs;
      }
      const displaySnapX = Number.isFinite(ring.readySnapX) ? ring.readySnapX : snap.snapX;
      const displaySnapZ = Number.isFinite(ring.readySnapZ) ? ring.readySnapZ : snap.snapZ;
      updateFarClipmapMaterialFrameUniforms(ring.material, {
        cameraX: cameraPosition.x,
        cameraZ: cameraPosition.z,
        clipInnerRadiusM: ring.innerRadiusM,
        clipOuterRadiusM: ring.outerRadiusM,
        ringOriginX: displaySnapX - ring.outerRadiusM,
        ringOriginZ: displaySnapZ - ring.outerRadiusM,
        cellSizeM: ring.cellSizeM,
        heightScale: this.config.heightScale,
        yOffset: this.config.yOffset,
      });
      const ringReady = ring.readySnapX === snap.snapX && ring.readySnapZ === snap.snapZ;
      ring.mesh.visible = this.visible && this.config.enabled && ringReady;
      if (ringReady) ready++;
    }
    this.lastStats = makeStats(this.config, this.visible, ready, frameStats, sourceReady, this.totals());
    return this.lastStats;
  }

  setDebugMode(mode: FarClipmapDebugMode): void {
    for (const ring of this.rings) setFarClipmapMaterialDebugMode(ring.material, mode);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    for (const ring of this.rings) {
      const ringReady = Number.isFinite(ring.readySnapX) && Number.isFinite(ring.readySnapZ);
      ring.mesh.visible = visible && this.config.enabled && ringReady;
    }
  }

  ownershipSnapshot(): FarClipmapOwnershipSnapshot {
    return {
      enabled: this.config.enabled,
      innerRadiusM: this.config.innerRadiusM,
      outerRadiusM: this.config.outerRadiusM,
      centerX: this.centerX,
      centerZ: this.centerZ,
      snapX: Number.isFinite(this.snapX) ? this.snapX : 0,
      snapZ: Number.isFinite(this.snapZ) ? this.snapZ : 0,
      ready: this.lastStats.pendingTiles === 0,
    };
  }

  dispose(): void {
    for (const ring of this.rings) {
      this.scene.remove(ring.mesh);
      ring.mesh.geometry.dispose();
      ring.material.dispose();
    }
    this.rings.length = 0;
  }

  private totals(): { buildMs: number; fallbackSamples: number; exceptionSamples: number } {
    return {
      buildMs: this.totalBuildMs,
      fallbackSamples: this.totalFallbackSamples,
      exceptionSamples: this.totalExceptionSamples,
    };
  }
}
