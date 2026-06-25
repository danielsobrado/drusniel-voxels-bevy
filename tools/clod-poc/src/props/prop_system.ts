import * as THREE from "three";
import type { ClodHooks } from "../core/hooks.js";
import type { CustomPropsSettings, PropAssetDef, PropPlacementScene } from "./prop_types.js";
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
const _billboardQuat = new THREE.Quaternion();

type BucketKind = "opaque" | "shadow" | "billboard";

interface InstanceLodState {
  lod: number;
}

interface MeshDraw {
  assetId: string;
  lod: number;
  matrix: THREE.Matrix4;
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
  private readonly buckets = new Map<string, RenderBucket>();
  private readonly lodState = new Map<number, InstanceLodState>();
  private frameId = 0;
  private ready = false;
  private stats: PropStats = { ...EMPTY_PROP_STATS };
  private collidersActive = 0;

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

  buildColliderInstances(playerPos: [number, number, number]): PropColliderInstanceInput[] {
    if (!this.grid) return [];
    const out: PropColliderInstanceInput[] = [];
    for (let idx = 0; idx < this.grid.instances.length; idx++) {
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
    return out;
  }

  setCollidersActive(count: number): void {
    this.collidersActive = count;
  }

  async init(): Promise<void> {
    const { loaded } = await this.registry.loadManifest();
    for (const asset of loaded) this.loadedAssets.set(asset.def.id, asset);

    const instances = assignPropCellCoords(this.deps.placementScene.instances, this.deps.settings.spatial.cellSizeM);
    this.grid = PropSpatialGrid.fromInstances(instances, this.deps.settings.spatial.cellSizeM);
    this.ensureBuckets();
    this.ready = true;
  }

  update(camera: THREE.PerspectiveCamera): void {
    if (!this.ready || !this.grid || !this.deps.settings.enabled) {
      this.root.visible = false;
      return;
    }

    const t0 = performance.now();
    this.frameId++;
    this.root.visible = true;

    const metadataByAssetId = new Map(
      [...this.loadedAssets.entries()].map(([id, asset]) => [id, asset.metadata]),
    );
    const cull = cullPropSpatialGrid(this.grid, camera, this.deps.settings, metadataByAssetId, this.frameId);

    const viewportH = Math.max(1, window.innerHeight);
    const fovY = THREE.MathUtils.degToRad(camera.fov);
    const camPos: [number, number, number] = [camera.position.x, camera.position.y, camera.position.z];

    const opaqueMatrices = new Map<string, THREE.Matrix4[]>();
    const shadowMatrices = new Map<string, THREE.Matrix4[]>();
    const billboardMatrices = new Map<string, THREE.Matrix4[]>();
    const trianglesByLod = [0, 0, 0, 0, 0];
    let billboardInstances = 0;
    const debugBounds: { min: THREE.Vector3; max: THREE.Vector3; lod: number }[] = [];
    const meshDraws: MeshDraw[] = [];

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
      _quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), inst.rotationY);
      _scale.setScalar(inst.scale);

      if (lod >= def.lod.distances.length) {
        billboardInstances++;
        if (!loaded.lodChain?.billboardGeometry) continue;
        _billboardQuat.copy(_quaternion);
        _matrix.compose(_position, _billboardQuat, _scale);
        const key = bucketKey(inst.assetId, def.lod.distances.length, "billboard");
        const list = billboardMatrices.get(key) ?? [];
        list.push(_matrix.clone());
        billboardMatrices.set(key, list);
        trianglesByLod[4] = (trianglesByLod[4] ?? 0) + 2;
        continue;
      }

      _matrix.compose(_position, _quaternion, _scale);
      const triCount = lodTriangleCount(loaded, lod);
      trianglesByLod[lod] = (trianglesByLod[lod] ?? 0) + triCount;
      meshDraws.push({
        assetId: inst.assetId,
        lod,
        matrix: _matrix.clone(),
        distance,
        triCount,
        shadowEligible: propCastsShadow(def, distance),
      });

      if (this.deps.settings.debug.showBounds || this.deps.settings.debug.lodColorOverlay) {
        _box.setFromCenterAndSize(_position, new THREE.Vector3(radius * 2, radius * 2, radius * 2));
        debugBounds.push({ min: _box.min.clone(), max: _box.max.clone(), lod });
      }
    }

    meshDraws.sort((a, b) => a.distance - b.distance);
    let shadowRemaining = this.deps.settings.shadows.maxShadowProps;
    let shadowCasters = 0;
    let visibleMeshes = 0;
    for (const draw of meshDraws) {
      visibleMeshes++;
      const useShadow = draw.shadowEligible && shadowRemaining > 0;
      if (useShadow) {
        shadowRemaining--;
        shadowCasters++;
        const key = bucketKey(draw.assetId, draw.lod, "shadow");
        const list = shadowMatrices.get(key) ?? [];
        list.push(draw.matrix);
        shadowMatrices.set(key, list);
      } else {
        const key = bucketKey(draw.assetId, draw.lod, "opaque");
        const list = opaqueMatrices.get(key) ?? [];
        list.push(draw.matrix);
        opaqueMatrices.set(key, list);
      }
    }

    const bucketMatrices = new Map<string, THREE.Matrix4[]>();
    for (const [key, matrices] of opaqueMatrices) bucketMatrices.set(key, matrices);
    for (const [key, matrices] of shadowMatrices) bucketMatrices.set(key, matrices);
    for (const [key, matrices] of billboardMatrices) bucketMatrices.set(key, matrices);

    for (const [key, bucket] of this.buckets) {
      const matrices = bucketMatrices.get(key) ?? [];
      bucket.mesh.count = matrices.length;
      bucket.mesh.visible = matrices.length > 0;
      for (let i = 0; i < matrices.length; i++) {
        bucket.mesh.setMatrixAt(i, matrices[i]!);
      }
      bucket.mesh.instanceMatrix.needsUpdate = matrices.length > 0;
    }

    const visibleCellSet = cull.visibleCellKeys;
    const visibleCells = this.grid.allCells().filter((c) => visibleCellSet.has(`${c.cellCoord[0]},${c.cellCoord[1]}`));
    const culledCells = this.grid.allCells().filter((c) => !visibleCellSet.has(`${c.cellCoord[0]},${c.cellCoord[1]}`));
    this.debug.update({
      settings: this.deps.settings.debug,
      visibleCells,
      culledCells,
      instanceBounds: debugBounds,
    });

    const drawCallsTotal = [...this.buckets.values()].filter((b) => b.mesh.visible).length;
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
    for (const bucket of this.buckets.values()) {
      bucket.mesh.geometry.dispose();
      const mat = bucket.mesh.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat.dispose();
      bucket.mesh.removeFromParent();
    }
    this.buckets.clear();
    this.registry.dispose();
    this.debug.dispose();
    this.root.removeFromParent();
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
}
