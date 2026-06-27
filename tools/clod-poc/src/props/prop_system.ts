import * as THREE from "three";
import type { ClodHooks } from "../core/hooks.js";
import type { CustomPropsSettings, PropAssetDef, PropAssetMetadata, PropPlacementScene } from "./prop_types.js";
import { PropAssetRegistry, type LoadedPropAsset } from "./prop_asset_loader.js";
import { assignPropCellCoords } from "./prop_placements.js";
import { cullPropSpatialGrid } from "./prop_culling.js";
import { PropDebugOverlay } from "./prop_debug.js";
import {
  propCastsShadow,
  propDistanceToCamera,
  propNeedsCollider,
  selectPropLodIndex,
} from "./prop_lod.js";
import { PropSpatialGrid } from "./prop_spatial_grid.js";
import { EMPTY_PROP_STATS, syncPropStatsToHooks, type PropStats } from "./prop_stats.js";
import { createBillboardMaterial } from "./prop_billboard.js";
import type { PropColliderInstanceInput } from "./prop_collider.js";

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _box = new THREE.Box3();
const _debugBoxSize = new THREE.Vector3();
const _yAxis = new THREE.Vector3(0, 1, 0);
const _billboardQuat = new THREE.Quaternion();

const PROP_MATRIX_UPLOAD_LIMIT_FALLBACK = 0;

type BucketKind = "opaque" | "shadow" | "billboard";

interface InstanceLodState {
  lod: number;
}

interface MeshDraw {
  instanceIndex: number;
  assetId: string;
  lod: number;
  distance: number;
  triCount: number;
  shadowEligible: boolean;
}

interface RenderBucket {
  assetId: string;
  lod: number;
  kind: BucketKind;
  mesh: THREE.InstancedMesh;
  maxCount: number;
}

function bucketKey(assetId: string, lod: number, kind: BucketKind): string {
  return `${assetId}:${lod}:${kind}`;
}

function lodGeometry(asset: LoadedPropAsset, lod: number): THREE.BufferGeometry | null {
  if (asset.lodChain) return asset.lodChain.levels[lod]?.geometry ?? null;
  let found: THREE.Mesh | null = null;
  asset.root.traverse((obj) => {
    if (!found && obj instanceof THREE.Mesh) found = obj;
  });
  const mesh = found as THREE.Mesh | null;
  return mesh?.geometry ?? null;
}

function lodTriangleCount(asset: LoadedPropAsset, lod: number): number {
  if (asset.lodChain) return asset.lodChain.levels[lod]?.triangleCount ?? asset.metadata.triangleCount;
  return asset.metadata.triangleCount;
}

function disposeBucket(bucket: RenderBucket): void {
  const mat = bucket.mesh.material;
  if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
  else mat.dispose();
  bucket.mesh.removeFromParent();
}

function insertShadowCandidate(candidates: MeshDraw[], draw: MeshDraw, limit: number): void {
  if (limit <= 0) return;
  if (candidates.length < limit) {
    candidates.push(draw);
    return;
  }
  let farthestIndex = 0;
  let farthestDistance = candidates[0]?.distance ?? -Infinity;
  for (let i = 1; i < candidates.length; i++) {
    const distance = candidates[i]!.distance;
    if (distance > farthestDistance) {
      farthestDistance = distance;
      farthestIndex = i;
    }
  }
  if (draw.distance < farthestDistance) candidates[farthestIndex] = draw;
}

export interface PropSystemDeps {
  scene: THREE.Scene;
  settings: CustomPropsSettings;
  placementScene: PropPlacementScene;
  getHooks?: () => ClodHooks | null;
}

export class PropSystem {
  private readonly root = new THREE.Group();
  private readonly registry: PropAssetRegistry;
  private readonly debug: PropDebugOverlay;
  private grid: PropSpatialGrid | null = null;
  private readonly assetById = new Map<string, PropAssetDef>();
  private readonly loadedAssets = new Map<string, LoadedPropAsset>();
  private readonly metadataByAssetId = new Map<string, PropAssetMetadata>();
  private readonly buckets = new Map<string, RenderBucket>();
  private readonly lodState = new Map<number, InstanceLodState>();
  private readonly meshDraws: MeshDraw[] = [];
  private readonly shadowCandidates: MeshDraw[] = [];
  private readonly shadowInstanceIndices = new Set<number>();
  private frameId = 0;
  private ready = false;
  private stats: PropStats = { ...EMPTY_PROP_STATS };
  private collidersActive = 0;
  private colliderQueryRadius = 0;

  constructor(private readonly deps: PropSystemDeps) {
    this.root.name = "custom-props";
    deps.scene.add(this.root);
    this.registry = new PropAssetRegistry(deps.settings);
    this.debug = new PropDebugOverlay(deps.scene);
    for (const def of deps.settings.props) this.assetById.set(def.id, def);
  }

  get isReady(): boolean {
    return this.ready;
  }

  getStats(): PropStats {
    return this.stats;
  }

  availablePrefabIds(): string[] {
    return [...this.assetById.keys()].sort((a, b) => a.localeCompare(b));
  }

  getPlacementSceneSnapshot(): PropPlacementScene {
    const instances = (this.grid?.instances ?? this.deps.placementScene.instances).map((instance) => ({
      assetId: instance.assetId,
      position: [...instance.position] as [number, number, number],
      rotationY: instance.rotationY,
      scale: instance.scale,
      seed: instance.seed,
      variationId: instance.variationId,
      flags: instance.flags,
      revision: instance.revision,
    }));
    return {
      schemaVersion: this.deps.placementScene.schemaVersion,
      sceneId: this.deps.placementScene.sceneId,
      instances,
    };
  }

  buildColliderInstances(playerPos: [number, number, number]): PropColliderInstanceInput[] {
    if (!this.grid || this.colliderQueryRadius <= 0) return [];
    const out: PropColliderInstanceInput[] = [];
    const cells = this.grid.nearbyCells(playerPos, this.colliderQueryRadius);
    for (const cell of cells) {
      for (const idx of cell.instanceIndices) {
        const inst = this.grid.instances[idx]!;
        const def = this.assetById.get(inst.assetId);
        const loaded = this.loadedAssets.get(inst.assetId);
        if (!def || !loaded) continue;
        const radius = loaded.metadata.boundingSphereRadius * inst.scale;
        const distance = propDistanceToCamera(playerPos, inst.position, radius);
        if (!propNeedsCollider(def, distance)) continue;
        out.push({
          key: String(idx),
          mode: def.collision.mode,
          position: inst.position,
          rotationY: inst.rotationY,
          scale: inst.scale,
          asset: loaded,
        });
      }
    }
    return out;
  }

  setCollidersActive(count: number): void {
    this.collidersActive = count;
  }

  async init(): Promise<void> {
    const { loaded } = await this.registry.loadManifest();
    for (const asset of loaded) {
      this.loadedAssets.set(asset.def.id, asset);
      this.metadataByAssetId.set(asset.def.id, asset.metadata);
    }
    this.replacePlacementScene(this.deps.placementScene);
    this.ready = true;
  }

  replacePlacementScene(placementScene: PropPlacementScene): void {
    this.deps.placementScene = placementScene;
    const instances = assignPropCellCoords(placementScene.instances, this.deps.settings.spatial.cellSizeM);
    this.grid = PropSpatialGrid.fromInstances(instances, this.deps.settings.spatial.cellSizeM);
    this.colliderQueryRadius = this.computeColliderQueryRadius();
    this.lodState.clear();
    this.clearBuckets();
    this.ensureBuckets();
    this.stats = {
      ...EMPTY_PROP_STATS,
      totalInstances: this.grid.instances.length,
      cellsTotal: this.grid.cells.size,
      collidersActive: this.collidersActive,
    };
  }

  update(camera: THREE.PerspectiveCamera): void {
    if (!this.ready || !this.grid || !this.deps.settings.enabled) {
      this.root.visible = false;
      return;
    }

    const t0 = performance.now();
    this.frameId++;
    this.root.visible = true;

    const cull = cullPropSpatialGrid(this.grid, camera, this.deps.settings, this.metadataByAssetId, this.frameId);

    const viewportH = Math.max(1, window.innerHeight);
    const fovY = THREE.MathUtils.degToRad(camera.fov);
    const camPos: [number, number, number] = [camera.position.x, camera.position.y, camera.position.z];
    const trianglesByLod = [0, 0, 0, 0, 0];
    const debugEnabled = this.deps.settings.debug.showCells
      || this.deps.settings.debug.showBounds
      || this.deps.settings.debug.lodColorOverlay;
    const debugBounds: { min: THREE.Vector3; max: THREE.Vector3; lod: number }[] = [];
    const bucketCounts = new Map<string, number>();
    this.meshDraws.length = 0;
    this.shadowCandidates.length = 0;
    this.shadowInstanceIndices.clear();

    let billboardInstances = 0;

    for (const idx of cull.visibleInstanceIndices) {
      const inst = this.grid.instances[idx]!;
      const def = this.assetById.get(inst.assetId);
      const loaded = this.loadedAssets.get(inst.assetId);
      if (!def || !loaded) continue;

      const radius = loaded.metadata.boundingSphereRadius * inst.scale;
      const distance = propDistanceToCamera(camPos, inst.position, radius);
      const previous = this.lodState.get(idx)?.lod ?? null;
      const lod = selectPropLodIndex(
        def,
        { camPos, propPos: inst.position, viewportH, fovY, thresholdPx: def.culling.minScreenPx },
        radius,
        previous,
        loaded.lodErrorWorld.length > 0 ? loaded.lodErrorWorld : undefined,
      );
      this.lodState.set(idx, { lod });

      if (lod < 0) continue;

      _position.set(inst.position[0], inst.position[1], inst.position[2]);
      _quaternion.setFromAxisAngle(_yAxis, inst.rotationY);
      _scale.setScalar(inst.scale);

      if (lod >= def.lod.distances.length) {
        if (!loaded.lodChain?.billboardGeometry) continue;
        _billboardQuat.copy(_quaternion);
        _matrix.compose(_position, _billboardQuat, _scale);
        const key = bucketKey(inst.assetId, def.lod.distances.length, "billboard");
        if (this.writeBucketMatrix(key, bucketCounts)) {
          billboardInstances++;
          trianglesByLod[4] = (trianglesByLod[4] ?? 0) + 2;
        }
        continue;
      }

      const triCount = lodTriangleCount(loaded, lod);
      trianglesByLod[lod] = (trianglesByLod[lod] ?? 0) + triCount;
      const draw: MeshDraw = {
        instanceIndex: idx,
        assetId: inst.assetId,
        lod,
        distance,
        triCount,
        shadowEligible: propCastsShadow(def, distance),
      };
      this.meshDraws.push(draw);
      if (draw.shadowEligible) insertShadowCandidate(this.shadowCandidates, draw, this.deps.settings.shadows.maxShadowProps);

      if (debugEnabled && (this.deps.settings.debug.showBounds || this.deps.settings.debug.lodColorOverlay)) {
        _debugBoxSize.set(radius * 2, radius * 2, radius * 2);
        _box.setFromCenterAndSize(_position, _debugBoxSize);
        debugBounds.push({ min: _box.min.clone(), max: _box.max.clone(), lod });
      }
    }

    for (const draw of this.shadowCandidates) this.shadowInstanceIndices.add(draw.instanceIndex);

    let visibleMeshes = 0;
    let shadowCasters = 0;
    for (const draw of this.meshDraws) {
      const inst = this.grid.instances[draw.instanceIndex]!;
      _position.set(inst.position[0], inst.position[1], inst.position[2]);
      _quaternion.setFromAxisAngle(_yAxis, inst.rotationY);
      _scale.setScalar(inst.scale);
      _matrix.compose(_position, _quaternion, _scale);
      const useShadow = this.shadowInstanceIndices.has(draw.instanceIndex);
      const kind: BucketKind = useShadow ? "shadow" : "opaque";
      const key = bucketKey(draw.assetId, draw.lod, kind);
      if (this.writeBucketMatrix(key, bucketCounts)) {
        visibleMeshes++;
        if (useShadow) shadowCasters++;
      }
    }

    const drawCallsTotal = this.applyBucketCounts(bucketCounts);
    this.updateDebug(debugEnabled, cull.visibleCellKeys, debugBounds);

    this.stats = {
      totalInstances: this.grid.instances.length,
      cellsTotal: this.grid.cells.size,
      cellsVisible: cull.visibleCells,
      cellsCulled: cull.culledCells,
      instancesVisible: visibleMeshes + billboardInstances,
      instancesCulled: cull.culledInstances,
      farCellsSkipped: cull.farCellSkipped,
      drawCallsOpaque: drawCallsTotal,
      drawCallsTotal,
      trianglesByLod,
      shadowCasters,
      collidersActive: this.collidersActive,
      billboardInstances,
      updateMs: performance.now() - t0,
    };

    const hooks = this.deps.getHooks?.();
    if (hooks?.stats) syncPropStatsToHooks(this.stats, hooks.stats.counters);
  }

  setEnabled(enabled: boolean): void {
    this.deps.settings.enabled = enabled;
    this.root.visible = enabled;
  }

  dispose(): void {
    this.clearBuckets();
    this.registry.dispose();
    this.debug.dispose();
    this.root.removeFromParent();
  }

  private clearBuckets(): void {
    for (const bucket of this.buckets.values()) disposeBucket(bucket);
    this.buckets.clear();
  }

  private ensureBuckets(): void {
    const maxInstances = Math.max(1, this.grid?.instances.length ?? 1);
    for (const def of this.deps.settings.props) {
      const loaded = this.loadedAssets.get(def.id);
      if (!loaded) continue;

      const lodCount = def.lod.distances.length;
      for (let lod = 0; lod < lodCount; lod++) {
        const geometry = lodGeometry(loaded, lod);
        if (!geometry) continue;
        this.addBucket(def.id, lod, "opaque", geometry, loaded.sourceMaterial, maxInstances, false);
        this.addBucket(def.id, lod, "shadow", geometry, loaded.sourceMaterial, maxInstances, true);
      }

      if (loaded.lodChain?.billboardGeometry) {
        const mat =
          (loaded.lodChain.billboardGeometry.userData.billboardMaterial as THREE.Material | undefined) ??
          createBillboardMaterial(loaded.sourceMaterial);
        this.addBucket(def.id, lodCount, "billboard", loaded.lodChain.billboardGeometry, mat, maxInstances, false);
      }
    }
  }

  private addBucket(
    assetId: string,
    lod: number,
    kind: BucketKind,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    maxCount: number,
    castShadow: boolean,
  ): void {
    const key = bucketKey(assetId, lod, kind);
    if (this.buckets.has(key)) return;
    const mesh = new THREE.InstancedMesh(geometry, material.clone(), maxCount);
    mesh.name = `prop:${assetId}:lod${lod}:${kind}`;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = kind !== "billboard";
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.visible = false;
    this.root.add(mesh);
    this.buckets.set(key, { assetId, lod, kind, mesh, maxCount });
  }

  private writeBucketMatrix(key: string, counts: Map<string, number>): boolean {
    const bucket = this.buckets.get(key);
    if (!bucket) return false;
    const count = counts.get(key) ?? PROP_MATRIX_UPLOAD_LIMIT_FALLBACK;
    if (count >= bucket.maxCount) return false;
    bucket.mesh.setMatrixAt(count, _matrix);
    counts.set(key, count + 1);
    return true;
  }

  private applyBucketCounts(counts: ReadonlyMap<string, number>): number {
    let visibleBuckets = 0;
    for (const [key, bucket] of this.buckets) {
      const count = counts.get(key) ?? 0;
      bucket.mesh.count = count;
      bucket.mesh.visible = count > 0;
      bucket.mesh.instanceMatrix.needsUpdate = count > 0;
      if (count > 0) visibleBuckets++;
    }
    return visibleBuckets;
  }

  private computeColliderQueryRadius(): number {
    if (!this.grid) return 0;
    let radius = 0;
    for (const inst of this.grid.instances) {
      const def = this.assetById.get(inst.assetId);
      const loaded = this.loadedAssets.get(inst.assetId);
      if (!def || !loaded || def.collision.mode === "none") continue;
      radius = Math.max(radius, def.collision.distance + loaded.metadata.boundingSphereRadius * inst.scale);
    }
    return radius;
  }

  private updateDebug(
    debugEnabled: boolean,
    visibleCellSet: ReadonlySet<string>,
    debugBounds: { min: THREE.Vector3; max: THREE.Vector3; lod: number }[],
  ): void {
    if (!debugEnabled || !this.grid) {
      this.debug.update({ settings: this.deps.settings.debug, visibleCells: [], culledCells: [], instanceBounds: [] });
      return;
    }
    const visibleCells = [];
    const culledCells = [];
    for (const cell of this.grid.allCells()) {
      const key = `${cell.cellCoord[0]},${cell.cellCoord[1]}`;
      if (visibleCellSet.has(key)) visibleCells.push(cell);
      else culledCells.push(cell);
    }
    this.debug.update({
      settings: this.deps.settings.debug,
      visibleCells,
      culledCells,
      instanceBounds: debugBounds,
    });
  }
}
