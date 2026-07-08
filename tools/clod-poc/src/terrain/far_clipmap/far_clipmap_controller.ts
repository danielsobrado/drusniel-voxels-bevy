import * as THREE from "three";
import type { FarClipmapConfig, FarClipmapDebugMode } from "./far_clipmap_config.js";
import { farClipmapRingRange, farClipmapSnap } from "./far_clipmap_keys.js";
import {
  createFarClipmapGridGeometry,
  createFarClipmapTerrainGeometry,
} from "./far_clipmap_geometry.js";
import {
  createFarClipmapMaterial,
  farClipmapMaterialDisplacementMode,
  farClipmapShaderRenderOrder,
  setFarClipmapMaterialDebugMode,
  updateFarClipmapMaterialFrameUniforms,
  updateFarClipmapMaterialSourceTexture,
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
  snapUpdatesThisFrame: number;
  sourceRefreshesThisFrame: number;
  sourceRefreshesTotal: number;
  sourceRefreshMsThisFrame: number;
  sourceRefreshMsTotal: number;
  sourceRevision: number;
  innerRadiusM: number;
  outerRadiusM: number;
  snapSizeM: number;
  centerX: number;
  centerZ: number;
  snappedOriginX: number;
  snappedOriginZ: number;
  snapErrorXM: number;
  snapErrorZM: number;
  snapErrorMaxM: number;
  shaderDisplacementEnabled: number;
  shaderDisplacedTiles: number;
  cpuBakedTiles: number;
  reusableGridTiles: number;
  geometryCreatesTotal: number;
  geometryDisposalsTotal: number;
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
  displacementMode: "shader" | "cpu-baked";
  sourceRevision: number;
  lastSourceRefreshFrame: number;
}

interface BuildFrameStats {
  rebuilt: number;
  snapUpdates: number;
  sourceRefreshes: number;
  sourceRefreshMs: number;
  buildMs: number;
  vertices: number;
  triangles: number;
  fallbackSamples: number;
  exceptionSamples: number;
}

interface FarClipmapStatsSnapshotInput {
  centerX: number;
  centerZ: number;
  snapX: number;
  snapZ: number;
  sourceRevision: number;
  shaderDisplacedTiles: number;
  cpuBakedTiles: number;
  reusableGridTiles: number;
  geometryCreatesTotal: number;
  geometryDisposalsTotal: number;
}

interface FarClipmapTotals {
  buildMs: number;
  sourceRefreshes: number;
  sourceRefreshMs: number;
  fallbackSamples: number;
  exceptionSamples: number;
}

function emptyFrameStats(): BuildFrameStats {
  return {
    rebuilt: 0,
    snapUpdates: 0,
    sourceRefreshes: 0,
    sourceRefreshMs: 0,
    buildMs: 0,
    vertices: 0,
    triangles: 0,
    fallbackSamples: 0,
    exceptionSamples: 0,
  };
}

function emptySnapshot(): FarClipmapStatsSnapshotInput {
  return {
    centerX: 0,
    centerZ: 0,
    snapX: 0,
    snapZ: 0,
    sourceRevision: 0,
    shaderDisplacedTiles: 0,
    cpuBakedTiles: 0,
    reusableGridTiles: 0,
    geometryCreatesTotal: 0,
    geometryDisposalsTotal: 0,
  };
}

function makeStats(
  config: FarClipmapConfig,
  visible: boolean,
  readyTiles: number,
  frameStats: BuildFrameStats,
  sourceReady: boolean,
  totals: FarClipmapTotals,
  snapshot: FarClipmapStatsSnapshotInput,
): FarClipmapStats {
  const pendingTiles = Math.max(0, config.ringCount - readyTiles);
  const snapErrorXM = snapshot.centerX - snapshot.snapX;
  const snapErrorZM = snapshot.centerZ - snapshot.snapZ;
  const shaderDisplacementEnabled = snapshot.shaderDisplacedTiles > 0 ? 1 : 0;
  return {
    enabled: config.enabled ? 1 : 0,
    visible: visible && config.enabled ? 1 : 0,
    ringCount: config.ringCount,
    activeTiles: visible && config.enabled ? config.ringCount : 0,
    readyTiles,
    pendingTiles,
    rebuiltTilesThisFrame: frameStats.rebuilt,
    snapUpdatesThisFrame: frameStats.snapUpdates,
    sourceRefreshesThisFrame: frameStats.sourceRefreshes,
    sourceRefreshesTotal: totals.sourceRefreshes,
    sourceRefreshMsThisFrame: frameStats.sourceRefreshMs,
    sourceRefreshMsTotal: totals.sourceRefreshMs,
    sourceRevision: snapshot.sourceRevision,
    innerRadiusM: config.innerRadiusM,
    outerRadiusM: config.outerRadiusM,
    snapSizeM: config.snapSizeM,
    centerX: snapshot.centerX,
    centerZ: snapshot.centerZ,
    snappedOriginX: snapshot.snapX,
    snappedOriginZ: snapshot.snapZ,
    snapErrorXM,
    snapErrorZM,
    snapErrorMaxM: Math.max(Math.abs(snapErrorXM), Math.abs(snapErrorZM)),
    shaderDisplacementEnabled,
    shaderDisplacedTiles: snapshot.shaderDisplacedTiles,
    cpuBakedTiles: snapshot.cpuBakedTiles,
    reusableGridTiles: snapshot.reusableGridTiles,
    geometryCreatesTotal: snapshot.geometryCreatesTotal,
    geometryDisposalsTotal: snapshot.geometryDisposalsTotal,
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
  private frameIndex = 0;
  private centerX = 0;
  private centerZ = 0;
  private snapX = Number.NaN;
  private snapZ = Number.NaN;
  private lastSourceRevision = 0;
  private lastStats: FarClipmapStats;
  private totalBuildMs = 0;
  private totalSourceRefreshes = 0;
  private totalSourceRefreshMs = 0;
  private totalFallbackSamples = 0;
  private totalExceptionSamples = 0;
  private geometryCreatesTotal = 0;
  private geometryDisposalsTotal = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly config: FarClipmapConfig,
    private readonly source: FarClipmapSource,
    options: FarClipmapControllerOptions,
  ) {
    this.lastStats = makeStats(config, false, 0, emptyFrameStats(), false, this.totals(), emptySnapshot());
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
        shaderDisplacement: config.shaderDisplacement,
        gridResolution: config.gridResolution,
      });
      const mesh = new THREE.Mesh(createFarClipmapGridGeometry({ gridResolution: config.gridResolution }), material);
      this.geometryCreatesTotal++;
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
        displacementMode: farClipmapMaterialDisplacementMode(material),
        sourceRevision: Number.NaN,
        lastSourceRefreshFrame: -1,
      });
    }
  }

  update(cameraPosition: THREE.Vector3): FarClipmapStats {
    this.frameIndex++;
    const frameStats = emptyFrameStats();
    const sourceReady = this.source.isReady?.() ?? true;
    this.lastSourceRevision = this.sourceRevision();
    if (!this.config.enabled) {
      this.lastStats = makeStats(this.config, false, 0, frameStats, sourceReady, this.totals(), this.snapshot());
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
      const displaySnapX = Number.isFinite(ring.readySnapX) && !stale ? ring.readySnapX : snap.snapX;
      const displaySnapZ = Number.isFinite(ring.readySnapZ) && !stale ? ring.readySnapZ : snap.snapZ;
      const ringOriginX = displaySnapX - ring.outerRadiusM;
      const ringOriginZ = displaySnapZ - ring.outerRadiusM;

      if (stale && this.canRefreshRing(ring, sourceReady, frameStats)) {
        const startedAt = performance.now();
        ring.readySnapX = snap.snapX;
        ring.readySnapZ = snap.snapZ;
        frameStats.snapUpdates++;

        if (ring.displacementMode === "cpu-baked") {
          const oldGeo = ring.mesh.geometry;
          const buildStats = { vertices: 0, triangles: 0, fallbackSamples: 0, exceptionSamples: 0 };
          const newGeo = createFarClipmapTerrainGeometry({
            gridResolution: this.config.gridResolution,
            centerX: snap.snapX,
            centerZ: snap.snapZ,
            innerRadiusM: ring.innerRadiusM,
            outerRadiusM: ring.outerRadiusM,
            heightScale: this.config.heightScale,
            yOffset: this.config.yOffset,
            source: this.source,
            stats: buildStats,
          });
          ring.mesh.geometry = newGeo;
          oldGeo.dispose();
          this.geometryCreatesTotal++;
          this.geometryDisposalsTotal++;
          frameStats.rebuilt++;
          frameStats.vertices += buildStats.vertices || vertexCount;
          frameStats.triangles += buildStats.triangles || triangleCount;
          frameStats.fallbackSamples += buildStats.fallbackSamples;
          frameStats.exceptionSamples += buildStats.exceptionSamples;
          this.totalFallbackSamples += buildStats.fallbackSamples;
          this.totalExceptionSamples += buildStats.exceptionSamples;
        } else {
          this.refreshShaderSourceTexture(ring, ringOriginX, ringOriginZ, cameraPosition, frameStats);
        }

        const buildMs = performance.now() - startedAt;
        frameStats.buildMs += ring.displacementMode === "cpu-baked" ? buildMs : 0;
        this.totalBuildMs += ring.displacementMode === "cpu-baked" ? buildMs : 0;
      } else if (this.shouldRefreshStableShaderRing(ring, sourceReady, frameStats)) {
        this.refreshShaderSourceTexture(ring, ringOriginX, ringOriginZ, cameraPosition, frameStats);
      }

      updateFarClipmapMaterialFrameUniforms(ring.material, {
        cameraX: cameraPosition.x,
        cameraZ: cameraPosition.z,
        clipInnerRadiusM: ring.innerRadiusM,
        clipOuterRadiusM: ring.outerRadiusM,
        ringOriginX,
        ringOriginZ,
        cellSizeM: ring.cellSizeM,
        heightScale: this.config.heightScale,
        yOffset: this.config.yOffset,
      });
      if (ring.displacementMode === "shader") {
        ring.mesh.position.set(ringOriginX, 0, ringOriginZ);
      } else {
        ring.mesh.position.set(0, 0, 0);
      }
      const ringReady = ring.readySnapX === snap.snapX && ring.readySnapZ === snap.snapZ;
      ring.mesh.visible = this.visible && this.config.enabled && ringReady;
      if (ringReady) ready++;
    }
    this.lastStats = makeStats(this.config, this.visible, ready, frameStats, sourceReady, this.totals(), this.snapshot());
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
      this.geometryDisposalsTotal++;
    }
    this.rings.length = 0;
  }

  private canRefreshRing(ring: RingMesh, sourceReady: boolean, frameStats: BuildFrameStats): boolean {
    if (!sourceReady) return false;
    if (ring.displacementMode === "shader") return true;
    return frameStats.rebuilt < this.config.maxRebuildsPerFrame;
  }

  private shouldRefreshStableShaderRing(ring: RingMesh, sourceReady: boolean, frameStats: BuildFrameStats): boolean {
    if (!sourceReady || ring.displacementMode !== "shader") return false;
    if (frameStats.sourceRefreshes >= this.config.sourceRefreshMaxPerFrame) return false;
    if (!Number.isFinite(ring.readySnapX) || !Number.isFinite(ring.readySnapZ)) return false;
    if (ring.sourceRevision !== this.lastSourceRevision) return true;
    return this.frameIndex - ring.lastSourceRefreshFrame >= this.config.sourceRefreshIntervalFrames;
  }

  private refreshShaderSourceTexture(
    ring: RingMesh,
    ringOriginX: number,
    ringOriginZ: number,
    cameraPosition: THREE.Vector3,
    frameStats: BuildFrameStats,
  ): void {
    const startedAt = performance.now();
    const textureStats = updateFarClipmapMaterialSourceTexture(ring.material, {
      source: this.source,
      gridResolution: this.config.gridResolution,
      ringOriginX,
      ringOriginZ,
      cellSizeM: ring.cellSizeM,
      cameraX: cameraPosition.x,
      cameraZ: cameraPosition.z,
    });
    const refreshMs = performance.now() - startedAt;
    ring.sourceRevision = this.lastSourceRevision;
    ring.lastSourceRefreshFrame = this.frameIndex;
    frameStats.sourceRefreshes++;
    frameStats.sourceRefreshMs += refreshMs;
    frameStats.fallbackSamples += textureStats.fallbackSamples;
    frameStats.exceptionSamples += textureStats.exceptionSamples;
    this.totalSourceRefreshes++;
    this.totalSourceRefreshMs += refreshMs;
    this.totalFallbackSamples += textureStats.fallbackSamples;
    this.totalExceptionSamples += textureStats.exceptionSamples;
  }

  private sourceRevision(): number {
    const revision = this.source.revision?.() ?? 0;
    return Number.isFinite(revision) ? revision : 0;
  }

  private snapshot(): FarClipmapStatsSnapshotInput {
    let shaderDisplacedTiles = 0;
    let cpuBakedTiles = 0;
    let reusableGridTiles = 0;
    for (const ring of this.rings) {
      if (ring.displacementMode === "shader") shaderDisplacedTiles++;
      else cpuBakedTiles++;
      if (ring.mesh.geometry.getAttribute("position")?.count === this.config.gridResolution * this.config.gridResolution) {
        reusableGridTiles++;
      }
    }
    return {
      centerX: this.centerX,
      centerZ: this.centerZ,
      snapX: Number.isFinite(this.snapX) ? this.snapX : 0,
      snapZ: Number.isFinite(this.snapZ) ? this.snapZ : 0,
      sourceRevision: this.lastSourceRevision,
      shaderDisplacedTiles,
      cpuBakedTiles,
      reusableGridTiles,
      geometryCreatesTotal: this.geometryCreatesTotal,
      geometryDisposalsTotal: this.geometryDisposalsTotal,
    };
  }

  private totals(): FarClipmapTotals {
    return {
      buildMs: this.totalBuildMs,
      sourceRefreshes: this.totalSourceRefreshes,
      sourceRefreshMs: this.totalSourceRefreshMs,
      fallbackSamples: this.totalFallbackSamples,
      exceptionSamples: this.totalExceptionSamples,
    };
  }
}
