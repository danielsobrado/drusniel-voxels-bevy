import * as THREE from "three";
import type { FarClipmapConfig, FarClipmapDebugMode } from "./far_clipmap_config.js";
import { farClipmapRingRange, farClipmapSnap } from "./far_clipmap_keys.js";
import {
  createFarClipmapGridGeometry,
  createFarClipmapTerrainGeometry,
} from "./far_clipmap_geometry.js";
import {
  createFarClipmapMaterial,
  commitFarClipmapMaterialSourceUpdate,
  disposeFarClipmapMaterialSourceTextures,
  farClipmapMaterialDisplacementMode,
  farClipmapShaderRenderOrder,
  setFarClipmapMaterialDebugMode,
  setFarClipmapMaterialLighting,
  updateFarClipmapMaterialFrameUniforms,
  updateFarClipmapMaterialOwnershipMask,
  updateFarClipmapMaterialSourceTexture,
  type FarClipmapLighting,
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
  refinedClod?: {
    innerRadiusM: number;
    outerRadiusM: number;
    pageSizeM: number;
    readyPageKeys: readonly string[];
    readyPageKeySet?: ReadonlySet<string>;
  };
}

export interface FarClipmapControllerOptions {
  webGpuCompatibleMaterial?: boolean;
  /** Live environment lighting; applied to ring materials each update so the far
   *  clipmap is lit by the same rig as the near CLOD terrain. */
  getLighting?: () => FarClipmapLighting;
}

export interface RefinedClodReadinessInput {
  innerRadiusM: number;
  outerRadiusM: number;
  pageSizeM: number;
  readyPageKeys: readonly string[];
}

export interface FarClipmapController {
  update(cameraPosition: THREE.Vector3, motionPosition?: THREE.Vector3): FarClipmapStats;
  commitPendingUpload(): void;
  setRefinedClodReadiness(readiness: RefinedClodReadinessInput | null): void;
  setDebugMode(mode: FarClipmapDebugMode): void;
  setVisible(visible: boolean): void;
  dispose(): void;
  ownershipSnapshot(): FarClipmapOwnershipSnapshot;
}

interface RingMesh {
  mesh: THREE.Mesh;
  material: FarClipmapMaterial;
  standbyMaterial: FarClipmapMaterial | null;
  standbyMesh: THREE.Mesh | null;
  innerRadiusM: number;
  outerRadiusM: number;
  cellSizeM: number;
  readySnapX: number;
  readySnapZ: number;
  pendingSnapX: number;
  pendingSnapZ: number;
  displacementMode: "shader" | "cpu-baked";
  sourceRevision: number;
  lastSourceRefreshFrame: number;
  sourceUploadChannel: "source" | "water" | null;
  sourceUploadOffset: number;
  pendingSourceRefresh: (() => void) | null;
  ownershipRevision: number;
  ownershipOriginX: number;
  ownershipOriginZ: number;
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
  private lastUpdateX = Number.NaN;
  private lastUpdateZ = Number.NaN;
  private stationaryMotionFrames = 0;
  private snapX = Number.NaN;
  private snapZ = Number.NaN;
  private lastSourceRevision = 0;
  private firstObservedRevision = Number.NaN;
  private revisionChannelLive = false;
  private lastStats: FarClipmapStats;
  private totalBuildMs = 0;
  private totalSourceRefreshes = 0;
  private totalSourceRefreshMs = 0;
  private totalFallbackSamples = 0;
  private totalExceptionSamples = 0;
  private geometryCreatesTotal = 0;
  private geometryDisposalsTotal = 0;
  private uploadCooldownFrames = 0;
  private refinedClod: RefinedClodReadinessInput | null = null;
  private refinedClodKey = "";
  private refinedClodRevision = 0;
  private readonly getLighting?: () => FarClipmapLighting;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly config: FarClipmapConfig,
    private readonly source: FarClipmapSource,
    options: FarClipmapControllerOptions,
  ) {
    this.getLighting = options.getLighting;
    this.lastStats = makeStats(config, false, 0, emptyFrameStats(), false, this.totals(), emptySnapshot());
    for (let ring = 0; ring < config.ringCount; ring++) {
      const range = farClipmapRingRange(config, ring);
      const cellSizeM = ringCellSize(config, range.outerRadiusM);
      const material = createFarClipmapMaterial({
        debugMode: config.materialDebugMode,
        seaLevel: config.seaLevelM,
        clipInnerRadiusM: range.innerRadiusM,
        clipOuterRadiusM: range.outerRadiusM,
        cellSizeM,
        heightScale: config.heightScale,
        yOffset: config.yOffset,
        webGpuCompatible: options.webGpuCompatibleMaterial === true,
        shaderDisplacement: config.shaderDisplacement,
        gridResolution: config.gridResolution,
      });
      const geometry = createFarClipmapGridGeometry({ gridResolution: config.gridResolution });
      const mesh = new THREE.Mesh(geometry, material);
      const standbyMaterial = options.webGpuCompatibleMaterial === true && config.shaderDisplacement
        ? createFarClipmapMaterial({
          debugMode: config.materialDebugMode,
          seaLevel: config.seaLevelM,
          clipInnerRadiusM: range.innerRadiusM,
          clipOuterRadiusM: range.outerRadiusM,
          cellSizeM,
          heightScale: config.heightScale,
          yOffset: config.yOffset,
          webGpuCompatible: true,
          shaderDisplacement: true,
          gridResolution: config.gridResolution,
        })
        : null;
      const standbyMesh = standbyMaterial ? new THREE.Mesh(geometry, standbyMaterial) : null;
      this.geometryCreatesTotal++;
      mesh.name = "far-clipmap-ring-" + String(ring);
      mesh.frustumCulled = false;
      mesh.renderOrder = farClipmapShaderRenderOrder();
      mesh.visible = false;
      scene.add(mesh);
      if (standbyMesh) {
        standbyMesh.name = `far-clipmap-ring-${ring}-standby`;
        standbyMesh.frustumCulled = false;
        standbyMesh.renderOrder = farClipmapShaderRenderOrder();
        standbyMesh.scale.setScalar(0);
        standbyMesh.onAfterRender = () => {
          standbyMesh.visible = false;
          standbyMesh.scale.setScalar(1);
          standbyMesh.onAfterRender = () => {};
        };
        scene.add(standbyMesh);
      }
      this.rings.push({
        mesh,
        material,
        standbyMaterial,
        standbyMesh,
        innerRadiusM: range.innerRadiusM,
        outerRadiusM: range.outerRadiusM,
        cellSizeM,
        readySnapX: Number.NaN,
        readySnapZ: Number.NaN,
        pendingSnapX: Number.NaN,
        pendingSnapZ: Number.NaN,
        displacementMode: farClipmapMaterialDisplacementMode(material),
        sourceRevision: Number.NaN,
        lastSourceRefreshFrame: -1,
        sourceUploadChannel: null,
        sourceUploadOffset: 0,
        pendingSourceRefresh: null,
        ownershipRevision: -1,
        ownershipOriginX: Number.NaN,
        ownershipOriginZ: Number.NaN,
      });
    }
  }

  update(cameraPosition: THREE.Vector3, motionPosition = cameraPosition): FarClipmapStats {
    this.frameIndex++;
    const frameStats = emptyFrameStats();
    const sourceReady = this.source.isReady?.() ?? true;
    const sourceUploadPending = this.rings.some((ring) => ring.sourceUploadChannel !== null || ring.pendingSourceRefresh !== null)
      || this.uploadCooldownFrames > 0;
    if (this.uploadCooldownFrames > 0) this.uploadCooldownFrames--;
    this.lastSourceRevision = this.sourceRevision();
    // Once the source's revision has been seen to change, the revision channel is trusted for
    // change detection and the periodic full re-sample below becomes redundant.
    if (!Number.isFinite(this.firstObservedRevision)) this.firstObservedRevision = this.lastSourceRevision;
    else if (this.lastSourceRevision !== this.firstObservedRevision) this.revisionChannelLive = true;
    if (!this.config.enabled) {
      this.lastStats = makeStats(this.config, false, 0, frameStats, sourceReady, this.totals(), this.snapshot());
      return this.lastStats;
    }
    const motionTracked = motionPosition !== cameraPosition;
    const positionUnchanged = motionPosition.x === this.lastUpdateX && motionPosition.z === this.lastUpdateZ;
    this.stationaryMotionFrames = positionUnchanged ? this.stationaryMotionFrames + 1 : 0;
    const cameraStable = !motionTracked
      || this.stationaryMotionFrames >= this.config.sourceRefreshIntervalFrames;
    this.centerX = cameraPosition.x;
    this.centerZ = cameraPosition.z;
    this.lastUpdateX = motionPosition.x;
    this.lastUpdateZ = motionPosition.z;
    const snap = farClipmapSnap(cameraPosition.x, cameraPosition.z, this.config.snapSizeM);
    this.snapX = snap.snapX;
    this.snapZ = snap.snapZ;
    let ready = 0;
    const vertexCount = ringVertexCount(this.config);
    const triangleCount = ringTriangleCount(this.config);
    for (const [ringIndex, ring] of this.rings.entries()) {
      const stale = ring.readySnapX !== snap.snapX || ring.readySnapZ !== snap.snapZ;
      let displaySnapX = Number.isFinite(ring.readySnapX) ? ring.readySnapX : snap.snapX;
      let displaySnapZ = Number.isFinite(ring.readySnapZ) ? ring.readySnapZ : snap.snapZ;
      let ringOriginX = displaySnapX - ring.outerRadiusM;
      let ringOriginZ = displaySnapZ - ring.outerRadiusM;

      if (!sourceUploadPending && stale && this.canRefreshRing(ring, sourceReady, frameStats)) {
        const startedAt = performance.now();
        frameStats.snapUpdates++;

        if (ring.displacementMode === "cpu-baked") {
          ring.readySnapX = snap.snapX;
          ring.readySnapZ = snap.snapZ;
          displaySnapX = snap.snapX;
          displaySnapZ = snap.snapZ;
          ringOriginX = displaySnapX - ring.outerRadiusM;
          ringOriginZ = displaySnapZ - ring.outerRadiusM;
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
          const deferUpload = Number.isFinite(ring.sourceRevision) && ring.standbyMaterial !== null;
          if (deferUpload) {
            ring.pendingSnapX = snap.snapX;
            ring.pendingSnapZ = snap.snapZ;
          } else {
            ring.readySnapX = snap.snapX;
            ring.readySnapZ = snap.snapZ;
            displaySnapX = snap.snapX;
            displaySnapZ = snap.snapZ;
            ringOriginX = displaySnapX - ring.outerRadiusM;
            ringOriginZ = displaySnapZ - ring.outerRadiusM;
          }
          this.refreshShaderSourceTexture(
            ring,
            snap.snapX - ring.outerRadiusM,
            snap.snapZ - ring.outerRadiusM,
            cameraPosition,
            frameStats,
            deferUpload,
          );
        }

        const buildMs = performance.now() - startedAt;
        frameStats.buildMs += ring.displacementMode === "cpu-baked" ? buildMs : 0;
        this.totalBuildMs += ring.displacementMode === "cpu-baked" ? buildMs : 0;
      } else if (!sourceUploadPending && cameraStable && this.shouldRefreshStableShaderRing(ring, sourceReady, frameStats)) {
        this.refreshShaderSourceTexture(ring, ringOriginX, ringOriginZ, cameraPosition, frameStats, false);
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
      if (this.getLighting) {
        const lighting = this.getLighting();
        setFarClipmapMaterialLighting(ring.material, lighting);
        if (ring.standbyMaterial) setFarClipmapMaterialLighting(ring.standbyMaterial, lighting);
      }
      if (
        ring.ownershipRevision !== this.refinedClodRevision
        || ring.ownershipOriginX !== ringOriginX
        || ring.ownershipOriginZ !== ringOriginZ
      ) {
        const ownershipInput = ringIndex === 0 && this.refinedClod ? {
          gridResolution: this.config.gridResolution,
          ringOriginX,
          ringOriginZ,
          cellSizeM: ring.cellSizeM,
          centerX: cameraPosition.x,
          centerZ: cameraPosition.z,
          ...this.refinedClod,
        } : null;
        updateFarClipmapMaterialOwnershipMask(ring.material, ownershipInput);
        if (ring.standbyMaterial) updateFarClipmapMaterialOwnershipMask(ring.standbyMaterial, ownershipInput);
        ring.ownershipRevision = this.refinedClodRevision;
        ring.ownershipOriginX = ringOriginX;
        ring.ownershipOriginZ = ringOriginZ;
      }
      if (ring.displacementMode === "shader") {
        ring.mesh.position.set(ringOriginX, 0, ringOriginZ);
      } else {
        ring.mesh.position.set(0, 0, 0);
      }
      const ringReady = Number.isFinite(ring.readySnapX) && Number.isFinite(ring.readySnapZ);
      ring.mesh.visible = this.visible && this.config.enabled && ringReady;
      if (ringReady) ready++;
    }
    this.lastStats = makeStats(this.config, this.visible, ready, frameStats, sourceReady, this.totals(), this.snapshot());
    return this.lastStats;
  }

  commitPendingUpload(): void {
    for (const ring of this.rings) {
      if (ring.pendingSourceRefresh) {
        const refresh = ring.pendingSourceRefresh;
        ring.pendingSourceRefresh = null;
        refresh();
        return;
      }
      if (!ring.sourceUploadChannel) continue;
      const uploadMaterial = ring.standbyMaterial ?? ring.material;
      const channelDone = commitFarClipmapMaterialSourceUpdate(
        uploadMaterial,
        ring.sourceUploadChannel,
        ring.sourceUploadOffset,
        64 * 1024,
      );
      if (channelDone && ring.sourceUploadChannel === "source") {
        ring.sourceUploadChannel = "water";
        ring.sourceUploadOffset = 0;
      } else if (channelDone) {
        ring.sourceUploadChannel = null;
        ring.sourceUploadOffset = 0;
      } else {
        ring.sourceUploadOffset += 64 * 1024;
      }
      if (!ring.sourceUploadChannel && ring.standbyMaterial) {
        const previousMesh = ring.mesh;
        const previous = ring.material;
        previousMesh.visible = false;
        ring.mesh = ring.standbyMesh!;
        ring.standbyMesh = previousMesh;
        ring.material = ring.standbyMaterial;
        ring.standbyMaterial = previous;
        if (Number.isFinite(ring.pendingSnapX) && Number.isFinite(ring.pendingSnapZ)) {
          ring.readySnapX = ring.pendingSnapX;
          ring.readySnapZ = ring.pendingSnapZ;
          ring.pendingSnapX = Number.NaN;
          ring.pendingSnapZ = Number.NaN;
        }
        this.uploadCooldownFrames = 8;
      }
      return;
    }
  }

  setRefinedClodReadiness(readiness: RefinedClodReadinessInput | null): void {
    if (!readiness && !this.refinedClod) return;
    if (readiness && this.refinedClod
      && Math.max(0, readiness.innerRadiusM) === this.refinedClod.innerRadiusM
      && Math.max(readiness.innerRadiusM, readiness.outerRadiusM) === this.refinedClod.outerRadiusM
      && Math.max(1, readiness.pageSizeM) === this.refinedClod.pageSizeM
      && readiness.readyPageKeys.length === this.refinedClod.readyPageKeys.length
      && readiness.readyPageKeys.every((key, index) => key === this.refinedClod?.readyPageKeys[index])) {
      return;
    }
    const normalized = readiness ? {
      innerRadiusM: Math.max(0, readiness.innerRadiusM),
      outerRadiusM: Math.max(readiness.innerRadiusM, readiness.outerRadiusM),
      pageSizeM: Math.max(1, readiness.pageSizeM),
      readyPageKeys: [...new Set(readiness.readyPageKeys)].sort(),
    } : null;
    const key = normalized
      ? `${normalized.innerRadiusM}|${normalized.outerRadiusM}|${normalized.pageSizeM}|${normalized.readyPageKeys.join(";")}`
      : "";
    if (key === this.refinedClodKey) return;
    this.refinedClod = normalized;
    this.refinedClodKey = key;
    this.refinedClodRevision++;
  }

  setDebugMode(mode: FarClipmapDebugMode): void {
    for (const ring of this.rings) {
      setFarClipmapMaterialDebugMode(ring.material, mode);
      if (ring.standbyMaterial) setFarClipmapMaterialDebugMode(ring.standbyMaterial, mode);
    }
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    for (const ring of this.rings) {
      const ringReady = Number.isFinite(ring.readySnapX)
        && Number.isFinite(ring.readySnapZ);
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
      refinedClod: this.refinedClod ? {
        ...this.refinedClod,
        readyPageKeys: [...this.refinedClod.readyPageKeys],
      } : undefined,
    };
  }

  dispose(): void {
    for (const ring of this.rings) {
      this.scene.remove(ring.mesh);
      ring.standbyMesh?.removeFromParent();
      ring.mesh.geometry.dispose();
      disposeFarClipmapMaterialSourceTextures(ring.material);
      ring.material.dispose();
      if (ring.standbyMaterial) {
        disposeFarClipmapMaterialSourceTextures(ring.standbyMaterial);
        ring.standbyMaterial.dispose();
      }
      this.geometryDisposalsTotal++;
    }
    this.rings.length = 0;
  }

  private canRefreshRing(ring: RingMesh, sourceReady: boolean, frameStats: BuildFrameStats): boolean {
    if (!sourceReady) return false;
    if (ring.displacementMode === "shader") {
      return frameStats.sourceRefreshes < this.config.sourceRefreshMaxPerFrame;
    }
    return frameStats.rebuilt < this.config.maxRebuildsPerFrame;
  }

  private shouldRefreshStableShaderRing(ring: RingMesh, sourceReady: boolean, frameStats: BuildFrameStats): boolean {
    if (!sourceReady || ring.displacementMode !== "shader") return false;
    if (frameStats.sourceRefreshes >= this.config.sourceRefreshMaxPerFrame) return false;
    if (!Number.isFinite(ring.readySnapX) || !Number.isFinite(ring.readySnapZ)) return false;
    // The interval is a per-ring floor for every stable-ring refresh, revision-driven
    // included: during traversal the far-summary revision bumps almost every frame, and
    // without the floor each bump re-samples a full ring texture on the CPU (~1-2ms,
    // effectively every frame). Far content is 384m+ away — refreshing a ring at most
    // once per interval is imperceptible, and the deferred commits land on the next
    // refresh because the revision comparison below still sees them.
    if (this.frameIndex - ring.lastSourceRefreshFrame < this.config.sourceRefreshIntervalFrames) return false;
    if (ring.sourceRevision !== this.lastSourceRevision) return true;
    // Interval polling only guards sources that never report a revision change; each poll
    // re-samples the full source texture on the CPU, far too hot to run against a live channel.
    return this.source.revisionIsAuthoritative?.() !== true && !this.revisionChannelLive;
  }

  private refreshShaderSourceTexture(
    ring: RingMesh,
    ringOriginX: number,
    ringOriginZ: number,
    cameraPosition: THREE.Vector3,
    frameStats: BuildFrameStats,
    deferUpload: boolean,
    queueAfterRender = deferUpload,
  ): void {
    if (queueAfterRender) {
      const camera = cameraPosition.clone();
      ring.pendingSourceRefresh = () => this.refreshShaderSourceTexture(
        ring,
        ringOriginX,
        ringOriginZ,
        camera,
        emptyFrameStats(),
        deferUpload,
        false,
      );
      return;
    }
    const startedAt = performance.now();
    const targetMaterial = deferUpload && ring.standbyMaterial ? ring.standbyMaterial : ring.material;
    const textureStats = updateFarClipmapMaterialSourceTexture(targetMaterial, {
      source: this.source,
      gridResolution: this.config.gridResolution,
      ringOriginX,
      ringOriginZ,
      cellSizeM: ring.cellSizeM,
      cameraX: cameraPosition.x,
      cameraZ: cameraPosition.z,
      clipInnerRadiusM: ring.innerRadiusM,
      clipOuterRadiusM: ring.outerRadiusM,
      seaLevelM: this.config.seaLevelM,
      // The innermost ring renders inside its inner radius wherever refined pages are
      // missing (ownership fallback); those cells need real heights, not the zero fill.
      includeInnerRadius: this.refinedClod !== null && ring === this.rings[0],
      deferUpload,
    });
    ring.sourceUploadChannel = deferUpload ? "source" : null;
    ring.sourceUploadOffset = 0;
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
