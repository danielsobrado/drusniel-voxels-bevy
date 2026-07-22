import * as THREE from "three";
import type { ClodPageNode } from "../types.js";
import { UNDERSTORY_CLASSES, type UnderstoryClass, type UnderstorySettings } from "./understory_config.js";
import type { UnderstoryGeometryMap } from "./understory_geometry.js";
import {
  defaultUnderstoryTerrainSampler,
  emptyUnderstoryGenerationStats,
  generateUnderstoryInstances,
  type UnderstoryGenerationStats,
  type UnderstoryTerrainSampler,
} from "./understory_instances.js";
import {
  recordUnderstoryEarlyRejection,
  rejectUnderstoryPatchBeforeGeneration,
} from "./understory_patch_terrain_rejection.js";
import {
  clampFootprint,
  distance2d,
  footprintCenterX,
  footprintCenterZ,
  footprintRadius,
  type UnderstoryPatch,
} from "./understory_system_support.js";

export interface UnderstoryCpuPatchRuntimeOptions {
  nodes: ClodPageNode[];
  worldCells: number;
  root: THREE.Group;
  sampler?: UnderstoryTerrainSampler;
  geometries: () => UnderstoryGeometryMap;
  materialFor: (cls: UnderstoryClass) => THREE.Material;
  classCastsShadow: (cls: UnderstoryClass) => boolean;
}

export class UnderstoryCpuPatchRuntime {
  readonly nodes: ClodPageNode[];
  private readonly worldCells: number;
  private readonly root: THREE.Group;
  private readonly sampler: UnderstoryTerrainSampler | undefined;
  private readonly geometries: () => UnderstoryGeometryMap;
  private readonly materialFor: (cls: UnderstoryClass) => THREE.Material;
  private readonly classCastsShadow: (cls: UnderstoryClass) => boolean;

  private readonly matrix = new THREE.Matrix4();
  private readonly translation = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly upAxis = new THREE.Vector3(0, 1, 0);
  private readonly lastRefreshCenter = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0);

  patches: UnderstoryPatch[] = [];
  patchesDirty = true;
  readonly earlyGenerationStats: UnderstoryGenerationStats = emptyUnderstoryGenerationStats();

  constructor(options: UnderstoryCpuPatchRuntimeOptions) {
    this.nodes = options.nodes
      .filter((node) => node.level === 0)
      .sort((a, b) => a.footprint.minZ - b.footprint.minZ || a.footprint.minX - b.footprint.minX);
    this.worldCells = options.worldCells;
    this.root = options.root;
    this.sampler = options.sampler;
    this.geometries = options.geometries;
    this.materialFor = options.materialFor;
    this.classCastsShadow = options.classCastsShadow;
  }

  markDirty(): void {
    this.patchesDirty = true;
  }

  ensure(settings: UnderstorySettings, center: THREE.Vector3): void {
    if (!this.patchesDirty && this.lastRefreshCenter.distanceTo(center) < settings.refreshDistanceM) {
      this.updateVisibility(center, settings);
      return;
    }
    this.refreshForCenter(center, settings);
  }

  /** Refresh when dirty/center moved; otherwise only visibility. Returns true when patches were rebuilt. */
  update(settings: UnderstorySettings, center: THREE.Vector3): boolean {
    if (this.patchesDirty || this.lastRefreshCenter.distanceTo(center) >= settings.refreshDistanceM) {
      this.refreshForCenter(center, settings);
      return true;
    }
    this.updateVisibility(center, settings);
    return false;
  }

  clear(): void {
    for (const patch of this.patches) this.removePatch(patch);
    this.patches = [];
    Object.assign(this.earlyGenerationStats, emptyUnderstoryGenerationStats());
  }

  removeForNodes(nodeIds: Iterable<string>): void {
    const ids = new Set(nodeIds);
    if (ids.size === 0) return;
    const retained: UnderstoryPatch[] = [];
    for (const patch of this.patches) {
      if (ids.has(patch.nodeId)) this.removePatch(patch);
      else retained.push(patch);
    }
    this.patches = retained;
  }

  refreshForCenter(center: THREE.Vector3, settings: UnderstorySettings): void {
    this.lastRefreshCenter.copy(center);
    this.patchesDirty = false;
    const distance = settings.distanceM;
    const retained: UnderstoryPatch[] = [];
    for (const patch of this.patches) {
      if (distance2d(center.x, center.z, patch.centerX, patch.centerZ) > distance + patch.radius) {
        this.removePatch(patch);
      } else {
        retained.push(patch);
      }
    }
    this.patches = retained;

    const existing = new Set(this.patches.map((patch) => patch.nodeId));
    const candidates = this.nodes
      .filter((node) => !existing.has(node.id))
      .map((node) => ({
        node,
        distance: distance2d(center.x, center.z, footprintCenterX(node.footprint), footprintCenterZ(node.footprint)),
      }))
      .filter(({ node, distance: d }) => d <= distance + footprintRadius(node.footprint))
      .sort((a, b) => a.distance - b.distance);

    let totalInstances = this.patches.reduce((sum, patch) => sum + patch.instances.length, 0);
    let added = 0;
    let deferred = false;
    for (const { node } of candidates) {
      if (totalInstances >= settings.maxInstances) break;
      if (added >= settings.maxNewPatchesPerFrame) {
        deferred = true;
        break;
      }
      const footprint = clampFootprint(node.footprint, this.worldCells);
      const rejection = rejectUnderstoryPatchBeforeGeneration(
        footprint,
        settings,
        this.sampler ?? defaultUnderstoryTerrainSampler,
        this.worldCells,
      );
      if (rejection.reject) {
        recordUnderstoryEarlyRejection(this.earlyGenerationStats, rejection);
        continue;
      }
      const patch = this.createPatch(node, settings, settings.maxInstances - totalInstances);
      totalInstances += patch.instances.length;
      this.patches.push(patch);
      this.root.add(patch.group);
      added++;
    }
    this.patchesDirty = deferred;
    this.updateVisibility(center, settings);
  }

  updateVisibility(center: THREE.Vector3, settings: UnderstorySettings): void {
    for (const patch of this.patches) {
      const visible = distance2d(center.x, center.z, patch.centerX, patch.centerZ) <= settings.distanceM + patch.radius;
      patch.visible = visible;
      patch.group.visible = visible;
      for (const mesh of Object.values(patch.meshes)) mesh.visible = visible && mesh.count > 0;
    }
  }

  applyMaterials(): void {
    for (const patch of this.patches) {
      for (const cls of UNDERSTORY_CLASSES) {
        patch.meshes[cls].material = this.materialFor(cls);
        patch.meshes[cls].castShadow = this.classCastsShadow(cls);
      }
    }
  }

  private createPatch(node: ClodPageNode, settings: UnderstorySettings, capacityLeft: number): UnderstoryPatch {
    const generationStats = emptyUnderstoryGenerationStats();
    const footprint = clampFootprint(node.footprint, this.worldCells);
    const instances = generateUnderstoryInstances(
      footprint,
      settings,
      capacityLeft,
      generationStats,
      this.sampler,
      this.worldCells,
    );
    const centerX = footprintCenterX(footprint);
    const centerZ = footprintCenterZ(footprint);
    const group = new THREE.Group();
    group.name = `understory-patch-${node.id}`;
    group.position.set(centerX, 0, centerZ);
    const meshes = {} as Record<UnderstoryClass, THREE.InstancedMesh>;
    const geometries = this.geometries();
    for (const cls of UNDERSTORY_CLASSES) {
      const classInstances = instances.filter((instance) => instance.classId === cls);
      const capacity = Math.max(1, classInstances.length);
      const geometry = geometries[cls].clone();
      geometry.setAttribute("understoryWindPhase", new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
      geometry.setAttribute("understoryWorldXZ", new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2));
      const mesh = new THREE.InstancedMesh(geometry, this.materialFor(cls), capacity);
      mesh.name = `understory-${node.id}-${cls}`;
      mesh.count = 0;
      mesh.frustumCulled = true;
      mesh.castShadow = this.classCastsShadow(cls);
      mesh.receiveShadow = false;
      meshes[cls] = mesh;
      group.add(mesh);
    }
    const patch = {
      nodeId: node.id,
      footprint,
      centerX,
      centerZ,
      radius: footprintRadius(footprint),
      group,
      instances,
      meshes,
      visible: false,
      generationStats,
    };
    this.populatePatchMeshes(patch);
    return patch;
  }

  private populatePatchMeshes(patch: UnderstoryPatch): void {
    const counts = new Map<UnderstoryClass, number>();
    for (const cls of UNDERSTORY_CLASSES) counts.set(cls, 0);
    for (const instance of patch.instances) {
      const mesh = patch.meshes[instance.classId];
      const index = counts.get(instance.classId) ?? 0;
      if (index >= mesh.instanceMatrix.count) continue;
      this.translation.set(instance.position[0] - patch.centerX, instance.position[1], instance.position[2] - patch.centerZ);
      this.rotation.setFromAxisAngle(this.upAxis, instance.rotationY);
      this.scale.setScalar(instance.scale);
      this.matrix.compose(this.translation, this.rotation, this.scale);
      mesh.setMatrixAt(index, this.matrix);
      const phase = mesh.geometry.getAttribute("understoryWindPhase") as THREE.InstancedBufferAttribute;
      (phase.array as Float32Array)[index] = instance.windPhase;
      const worldXZ = mesh.geometry.getAttribute("understoryWorldXZ") as THREE.InstancedBufferAttribute;
      const worldArray = worldXZ.array as Float32Array;
      worldArray[index * 2] = instance.position[0];
      worldArray[index * 2 + 1] = instance.position[2];
      counts.set(instance.classId, index + 1);
    }
    for (const cls of UNDERSTORY_CLASSES) {
      const mesh = patch.meshes[cls];
      const count = counts.get(cls) ?? 0;
      mesh.count = count;
      mesh.visible = count > 0;
      mesh.instanceMatrix.needsUpdate = true;
      const phase = mesh.geometry.getAttribute("understoryWindPhase");
      if (phase) phase.needsUpdate = true;
      const worldXZ = mesh.geometry.getAttribute("understoryWorldXZ");
      if (worldXZ) worldXZ.needsUpdate = true;
      if (count > 0) {
        mesh.computeBoundingBox();
        mesh.computeBoundingSphere();
      }
    }
  }

  private removePatch(patch: UnderstoryPatch): void {
    this.root.remove(patch.group);
    for (const mesh of Object.values(patch.meshes)) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
  }
}
