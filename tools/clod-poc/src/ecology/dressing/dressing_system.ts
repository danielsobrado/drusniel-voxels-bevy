import * as THREE from "three";
import type { HydrologySystem } from "../../water/index.js";
import { surfaceHeight, surfaceNormal, terrainWeights } from "../../terrain/terrain.js";
import { treePcg2d01 } from "../../vegetation/gpu_authority/pcg2d.js";
import {
  DRESSING_CLASSES,
  DRESSING_CLASS_DEFINITIONS,
  dressingClassNumericId,
  type DressingClassId,
} from "./class_registry.js";
import type { DressingConfig, DressingQuality } from "./config.js";
import { acceptsCosmeticAtQuality } from "./config.js";
import { cloneDressingDiagnostics, createDressingDiagnostics, type DressingDiagnostics } from "./diagnostics.js";
import { deadfallOrientation, acceptDeadLogCandidate, createPairedStumpId } from "./persistent_candidates.js";
import { parentAttachmentStableId, stableIdKey, terrainDressingStableId } from "./stable_id.js";
import { acceptTerrainCandidate } from "./terrain_candidates.js";
import type { DressingEnvironmentSample, DressingStableId } from "./types.js";
import { attachmentAllowed, type AttachmentParent } from "./attachment_candidates.js";
import type { DressingAttachmentAnchor, DressingAnchorKind } from "./attachment_anchors.js";
import { evaluateHydrologyAffinity } from "./hydrology_affinity.js";

export interface DressingSystemOptions {
  readonly scene: THREE.Scene;
  readonly worldCells: number;
  readonly worldSeed: number;
  readonly config: DressingConfig;
  readonly hydrologySystem?: HydrologySystem | null;
  readonly quality?: DressingQuality;
  readonly unboundedWorld?: boolean;
  readonly maximumInstances?: number;
}

interface RenderCandidate {
  readonly classId: DressingClassId;
  readonly stableId: DressingStableId;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly scale: number;
  readonly parentStableId?: DressingStableId;
}

const CLASS_COLORS: Readonly<Record<DressingClassId, number>> = {
  dead_log_fresh: 0x76503a,
  dead_log_mossy: 0x4e5936,
  dead_log_rotten: 0x3f3429,
  stump_fresh: 0x76503a,
  stump_rotten: 0x3f3429,
  broken_snag: 0x554536,
  large_driftwood: 0x88765d,
  large_talus_boulder: 0x656761,
  shelf_fungus: 0xc49a6c,
  cap_fungus: 0xb77952,
  trunk_moss: 0x42643a,
  trunk_lichen: 0x9a9d78,
  root_moss: 0x365d35,
  hanging_vine: 0x3e6736,
  root_fern: 0x3b7440,
  moss_patch: 0x476f3c,
  lichen_patch: 0x9ca477,
  leaf_litter: 0x5f432b,
  needle_litter: 0x51452c,
  twig_cluster: 0x6b4a31,
  bark_chip_cluster: 0x68422c,
  small_talus: 0x77776e,
  river_cobbles: 0x787f7d,
  wet_stone_cluster: 0x3f4b4c,
  small_driftwood: 0x817057,
  bank_fern: 0x3d7843,
  cave_mouth_fern: 0x315f3a,
  cliff_fern: 0x4a7747,
  flower_patch: 0xc989a5,
};

export class DressingSystem {
  private readonly root = new THREE.Group();
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly axisY = new THREE.Vector3(0, 1, 0);
  private readonly meshes = new Map<DressingClassId, THREE.InstancedMesh>();
  private readonly geometries = new Map<DressingClassId, THREE.BufferGeometry>();
  private readonly materials = new Map<DressingClassId, THREE.MeshStandardMaterial>();
  private readonly diagnostics: DressingDiagnostics;
  private readonly radiusM: number;
  private readonly maximumInstances: number;
  private lastCenterX = Number.POSITIVE_INFINITY;
  private lastCenterZ = Number.POSITIVE_INFINITY;

  constructor(private readonly options: DressingSystemOptions) {
    this.radiusM = Math.min(110, Math.max(32, options.config.lod.terrainAttached[1]));
    this.maximumInstances = Math.max(256, options.maximumInstances ?? 16_000);
    this.diagnostics = createDressingDiagnostics(options.config.enabled);
    for (const classId of DRESSING_CLASSES) {
      this.geometries.set(classId, createDressingGeometry(classId));
      this.materials.set(classId, createDressingMaterial(classId));
    }
    this.root.name = "ecological-dressing";
    this.root.visible = options.config.enabled;
    options.scene.add(this.root);
    if (options.config.enabled) {
      const center = options.unboundedWorld ? { x: 0, z: 0 } : { x: options.worldCells * 0.5, z: options.worldCells * 0.5 };
      this.rebuild(center.x, center.z);
    }
  }

  update(center: { readonly x: number; readonly z: number }): void {
    if (!this.options.config.enabled) return;
    const refreshDistance = this.options.config.clusterSizeM * 0.5;
    if (Math.hypot(center.x - this.lastCenterX, center.z - this.lastCenterZ) >= refreshDistance) {
      this.rebuild(center.x, center.z);
    }
  }

  getStats(): DressingDiagnostics {
    return cloneDressingDiagnostics(this.diagnostics);
  }

  get enabled(): boolean {
    return this.options.config.enabled;
  }

  dispose(): void {
    this.clearMeshes();
    for (const geometry of this.geometries.values()) geometry.dispose();
    for (const material of this.materials.values()) material.dispose();
    this.geometries.clear();
    this.materials.clear();
    this.options.scene.remove(this.root);
  }

  private rebuild(centerX: number, centerZ: number): void {
    const started = performance.now();
    const candidates = this.generateCandidates(centerX, centerZ);
    const byClass = new Map<DressingClassId, RenderCandidate[]>();
    for (const candidate of candidates) {
      const entries = byClass.get(candidate.classId) ?? [];
      entries.push(candidate);
      byClass.set(candidate.classId, entries);
    }
    for (const classId of DRESSING_CLASSES) {
      const entries = byClass.get(classId);
      const existing = this.meshes.get(classId);
      if (!entries?.length) {
        if (existing) {
          existing.count = 0;
          existing.visible = false;
        }
        continue;
      }
      const geometry = this.geometries.get(classId);
      const material = this.materials.get(classId);
      if (!geometry || !material) throw new Error(`missing authored dressing render resources: ${classId}`);
      let mesh = existing;
      if (!mesh || mesh.instanceMatrix.count < entries.length) {
        if (mesh) this.root.remove(mesh);
        mesh = new THREE.InstancedMesh(geometry, material, nextPowerOfTwo(entries.length));
        mesh.name = `dressing:${classId}`;
        mesh.castShadow = DRESSING_CLASS_DEFINITIONS[classId].castsNearShadow;
        mesh.receiveShadow = true;
        this.root.add(mesh);
        this.meshes.set(classId, mesh);
      }
      mesh.visible = true;
      mesh.count = entries.length;
      for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        this.position.set(entry.x, entry.y, entry.z);
        this.rotation.setFromAxisAngle(this.axisY, entry.yaw);
        this.scale.setScalar(entry.scale);
        this.matrix.compose(this.position, this.rotation, this.scale);
        mesh.setMatrixAt(index, this.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.diagnostics.perClass[classId].visible = entries.length;
    }
    this.lastCenterX = centerX;
    this.lastCenterZ = centerZ;
    this.diagnostics.dressing_clusters_active = Math.max(1, Math.ceil((this.radiusM * 2) / this.options.config.clusterSizeM) ** 2);
    this.diagnostics.dressing_candidates_accepted = candidates.length;
    this.diagnostics.dressing_persistent_visible = candidates.filter((entry) => DRESSING_CLASS_DEFINITIONS[entry.classId].ownership === "persistent").length;
    const attachments = candidates.filter((entry) => DRESSING_CLASS_DEFINITIONS[entry.classId].ownership === "parent_attached");
    this.diagnostics.dressing_parent_attached_visible = attachments.length;
    this.diagnostics.dressing_terrain_attached_visible = candidates.filter((entry) => DRESSING_CLASS_DEFINITIONS[entry.classId].ownership === "terrain_attached").length;
    this.diagnostics.dressing_attachment_count = attachments.length;
    this.diagnostics.dressing_attachment_parents = new Set(
      attachments.flatMap((entry) => entry.parentStableId ? [stableIdKey(entry.parentStableId)] : []),
    ).size;
    this.diagnostics.dressing_main_thread_ms = performance.now() - started;
    this.publishDiagnostics();
  }

  private generateCandidates(centerX: number, centerZ: number): RenderCandidate[] {
    const candidates: RenderCandidate[] = [];
    this.diagnostics.dressing_candidates_generated = 0;
    for (const classId of DRESSING_CLASSES) {
      this.diagnostics.perClass[classId].generated = 0;
      this.diagnostics.perClass[classId].accepted = 0;
      this.diagnostics.perClass[classId].visible = 0;
    }
    for (const classId of DRESSING_CLASSES) {
      const definition = DRESSING_CLASS_DEFINITIONS[classId];
      if (definition.ownership === "parent_attached" || classId === "stump_fresh" || classId === "stump_rotten") continue;
      const density = configuredDensityPerHectare(classId, this.options.config);
      if (!density) continue;
      const spacing = Math.max(2, definition.spacingM);
      const minCellX = Math.floor((centerX - this.radiusM) / spacing);
      const maxCellX = Math.floor((centerX + this.radiusM) / spacing);
      const minCellZ = Math.floor((centerZ - this.radiusM) / spacing);
      const maxCellZ = Math.floor((centerZ + this.radiusM) / spacing);
      const acceptProbability = Math.min(1, density * spacing * spacing / 10_000);
      for (let cellZ = minCellZ; cellZ <= maxCellZ && candidates.length < this.maximumInstances; cellZ++) {
        for (let cellX = minCellX; cellX <= maxCellX && candidates.length < this.maximumInstances; cellX++) {
          this.diagnostics.dressing_candidates_generated++;
          this.diagnostics.perClass[classId].generated++;
          const id = terrainDressingStableId({
            worldSeed: this.options.worldSeed,
            classId,
            cellX,
            cellZ,
            generatorSchemaVersion: this.options.config.generatorSchemaVersion,
          });
          const rolls = treePcg2d01(id.lo | 0, id.hi | 0, 0x4100 + dressingClassNumericId(classId));
          if (rolls[0] >= acceptProbability) continue;
          if (definition.ownership !== "persistent" && !acceptsCosmeticAtQuality(id.lo, this.options.quality ?? "balanced", this.options.config)) continue;
          const jitter = spacing * 0.4;
          const x = (cellX + 0.5) * spacing + (rolls[1] * 2 - 1) * jitter;
          const zRoll = treePcg2d01(id.hi | 0, id.lo | 0, 0x4201)[0];
          const z = (cellZ + 0.5) * spacing + (zRoll * 2 - 1) * jitter;
          if (Math.hypot(x - centerX, z - centerZ) > this.radiusM || !this.inWorld(x, z)) continue;
          const sample = this.sampleEnvironment(x, z);
          let yaw = treePcg2d01(id.lo | 0, id.hi | 0, 0x4202)[0] * Math.PI * 2;
          if (classId === "large_driftwood" || classId === "small_driftwood") {
            const affinity = evaluateHydrologyAffinity(classId, sample, rolls[1]);
            if (!affinity.accepted || affinity.orientationRad === null) continue;
            yaw = affinity.orientationRad;
          }
          if (classId.startsWith("dead_log")) {
            const downhill = Math.atan2(-sample.normal[2], -sample.normal[0]);
            yaw = deadfallOrientation(downhill, Math.PI * 0.18, yaw, rolls[1]);
            const halfLength = 1.5;
            const endpoints: [number, number] = [
              Math.abs(this.surfaceHeightAt(x + Math.cos(yaw) * halfLength, z + Math.sin(yaw) * halfLength) - sample.position[1]),
              Math.abs(this.surfaceHeightAt(x - Math.cos(yaw) * halfLength, z - Math.sin(yaw) * halfLength) - sample.position[1]),
            ];
            if (!acceptDeadLogCandidate(sample, endpoints)) continue;
          } else if (definition.ownership === "terrain_attached" && !acceptTerrainCandidate(classId, sample)) {
            continue;
          } else if (definition.ownership === "persistent" && !persistentSurfaceAccepted(classId, sample)) {
            continue;
          }
          const scale = 0.75 + treePcg2d01(id.hi | 0, id.lo | 0, 0x4203)[1] * 0.65;
          const candidate = {
            classId,
            stableId: id,
            x,
            y: sample.position[1] + geometrySupportOffset(classId) * scale,
            z,
            yaw,
            scale,
          };
          candidates.push(candidate);
          this.diagnostics.perClass[classId].accepted++;
          if (classId.startsWith("dead_log")) this.appendPairedStump(candidate, candidates);
          this.appendParentAttachments(candidate, sample, candidates);
        }
      }
    }
    if (candidates.length >= this.maximumInstances) this.diagnostics.dressing_overflow_count++;
    return candidates;
  }

  private appendPairedStump(deadfall: RenderCandidate, candidates: RenderCandidate[]): void {
    if (candidates.length >= this.maximumInstances) return;
    const deadfallDensity = this.options.config.densities.deadfallPerHectare;
    const stumpDensity = this.options.config.densities.stumpsPerHectare;
    if (deadfallDensity <= 0 || stumpDensity <= 0) return;
    const stumpId = createPairedStumpId(deadfall.stableId);
    const pairingRoll = treePcg2d01(stumpId.lo | 0, stumpId.hi | 0, 0x4305)[0];
    if (pairingRoll >= Math.min(1, stumpDensity / deadfallDensity)) return;
    const classId: DressingClassId = deadfall.classId === "dead_log_fresh" ? "stump_fresh" : "stump_rotten";
    const x = deadfall.x - Math.cos(deadfall.yaw) * 1.5;
    const z = deadfall.z - Math.sin(deadfall.yaw) * 1.5;
    const stump: RenderCandidate = {
      classId,
      stableId: stumpId,
      x,
      y: this.surfaceHeightAt(x, z) + geometrySupportOffset(classId) * deadfall.scale * 0.85,
      z,
      yaw: deadfall.yaw,
      scale: deadfall.scale * 0.85,
    };
    candidates.push(stump);
    this.diagnostics.perClass[classId].generated++;
    this.diagnostics.perClass[classId].accepted++;
    this.appendParentAttachments(stump, this.sampleEnvironment(x, z), candidates);
  }

  private appendParentAttachments(parent: RenderCandidate, sample: DressingEnvironmentSample, candidates: RenderCandidate[]): void {
    if (!parent.classId.startsWith("dead_log") && !parent.classId.startsWith("stump") && parent.classId !== "broken_snag") return;
    const rotten = parent.classId.includes("rotten");
    const mossy = parent.classId.includes("mossy");
    const attachments: DressingClassId[] = parent.classId === "broken_snag"
      ? ["shelf_fungus", "trunk_moss", "trunk_lichen", "hanging_vine"]
      : parent.classId.startsWith("stump") && rotten
        ? ["shelf_fungus", "cap_fungus", "root_moss", "root_fern"]
        : rotten
          ? ["shelf_fungus", "cap_fungus", "trunk_moss"]
          : mossy ? ["shelf_fungus", "trunk_moss"] : [];
    for (let slot = 0; slot < attachments.length && candidates.length < this.maximumInstances; slot++) {
      const classId = attachments[slot];
      const rolls = treePcg2d01(parent.stableId.lo | 0, parent.stableId.hi | 0, 0x4300 + slot);
      if (rolls[0] > Math.max(0.15, sample.moisture * 0.7)) continue;
      const attachmentParent = dressingAttachmentParent(parent);
      const anchor = dressingAttachmentAnchor(classId, slot);
      if (!attachmentAllowed(classId, attachmentParent, anchor, sample)) continue;
      const offset = parent.classId.startsWith("stump") ? 0.35 : (slot - 1) * 0.55;
      candidates.push({
        classId,
        stableId: parentAttachmentStableId({
          worldSeed: this.options.worldSeed,
          generatorSchemaVersion: this.options.config.generatorSchemaVersion,
          parentStableId: parent.stableId,
          classId,
          attachmentSlot: slot,
        }),
        x: parent.x + Math.cos(parent.yaw) * offset,
        y: parent.y + (classId === "cap_fungus" ? 0.02 : 0.3),
        z: parent.z + Math.sin(parent.yaw) * offset,
        yaw: parent.yaw + rolls[1] * Math.PI,
        scale: 0.7 + rolls[1] * 0.5,
        parentStableId: parent.stableId,
      });
      this.diagnostics.perClass[classId].generated++;
      this.diagnostics.perClass[classId].accepted++;
    }
  }

  private inWorld(x: number, z: number): boolean {
    return this.options.unboundedWorld || (x >= 0 && z >= 0 && x <= this.options.worldCells && z <= this.options.worldCells);
  }

  private sampleEnvironment(x: number, z: number): DressingEnvironmentSample {
    const hydrology = this.options.hydrologySystem?.sample(x, z, 4);
    const height = hydrology?.terrainY ?? this.surfaceHeightAt(x, z);
    const normal = this.surfaceNormalAt(x, z);
    const materials = terrainWeights(height, normal[1]);
    const forestNoise = treePcg2d01(Math.floor(x / 32), Math.floor(z / 32), this.options.worldSeed + 0x4401)[0];
    const forest = smoothstep(0.28, 0.78, forestNoise);
    const edge = 1 - Math.min(1, Math.abs(forestNoise - 0.53) / 0.25);
    const bankFlow = this.sampleBankFlow(x, z, hydrology);
    return {
      bankFlow,
      position: [x, height, z],
      normal,
      materialWeights: materials,
      waterDepthM: hydrology?.depth ?? 0,
      shoreDistanceM: hydrology?.shoreDistance ?? 999,
      flow: [hydrology?.flowX ?? 0, hydrology?.flowZ ?? 0],
      moisture: Math.max(forest * 0.45, hydrology?.moisture ?? 0.35),
      wetness: Math.max(hydrology?.moisture ?? 0, hydrology?.depth ? 1 : 0),
      canopyBroadleaf: forest * (materials[3] < 0.3 ? 0.7 : 0.2),
      canopyConifer: forest * (materials[3] >= 0.18 ? 0.75 : 0.3),
      skyExposure: 1 - forest * 0.75,
      hardness: materials[1],
      sediment: materials[2] + (hydrology?.riverMask ?? 0) * 0.4,
      deposition: Math.max(0, 1 - (hydrology?.flowStrength ?? 0)),
      exactVoxelSurface: false,
      terrainEdited: false,
      structureExcluded: false,
      persistentExcluded: false,
      forestEdge: edge,
      sunExposure: 1 - forest * 0.7,
      caveMouthFactor: 0,
    };
  }

  /**
   * Strongest adjacent water flow for a dry near-shore sample. Dry hydrology cells
   * carry zero flow, so bank classes (river cobbles, driftwood) can only see the river
   * they border through a short neighbourhood probe. Returns undefined away from
   * shorelines to keep the common case at zero extra hydrology samples.
   */
  private sampleBankFlow(
    x: number,
    z: number,
    center: ReturnType<HydrologySystem["sample"]> | undefined,
  ): readonly [number, number] | undefined {
    const system = this.options.hydrologySystem;
    if (!system || !center) return undefined;
    const nearShore = center.shoreDistance >= 0 && center.shoreDistance <= 6;
    const dry = center.depth <= 0.12;
    if (!dry || !nearShore) return undefined;
    // Matches the hydrology tile texel pitch so a bank candidate one texel from the
    // channel still lands a wet probe.
    const step = 4;
    let bestX = 0;
    let bestZ = 0;
    let bestSpeed = 0;
    for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]] as const) {
      const neighbor = system.sample(x + dx, z + dz, 4);
      if (neighbor.depth <= 0) continue;
      const speed = Math.hypot(neighbor.flowX, neighbor.flowZ);
      if (speed > bestSpeed) {
        bestSpeed = speed;
        bestX = neighbor.flowX;
        bestZ = neighbor.flowZ;
      }
    }
    return bestSpeed > 0 ? [bestX, bestZ] : undefined;
  }

  private surfaceHeightAt(x: number, z: number): number {
    return this.options.hydrologySystem?.terrainHeight(x, z) ?? surfaceHeight(x, z);
  }

  private surfaceNormalAt(x: number, z: number): [number, number, number] {
    if (!this.options.hydrologySystem) return surfaceNormal(x, z);
    const step = 0.5;
    const dx = this.surfaceHeightAt(x - step, z) - this.surfaceHeightAt(x + step, z);
    const dz = this.surfaceHeightAt(x, z - step) - this.surfaceHeightAt(x, z + step);
    const dy = step * 2;
    const inverseLength = 1 / Math.max(1e-6, Math.hypot(dx, dy, dz));
    return [dx * inverseLength, dy * inverseLength, dz * inverseLength];
  }

  private clearMeshes(): void {
    for (const mesh of this.meshes.values()) {
      this.root.remove(mesh);
    }
    this.meshes.clear();
  }

  private publishDiagnostics(): void {
    const counters = (globalThis as typeof globalThis & {
      window?: { __drusnielClod?: { stats?: { counters?: Record<string, number> } } };
    }).window?.__drusnielClod?.stats?.counters;
    if (!counters) return;
    for (const [name, value] of Object.entries(this.diagnostics)) {
      if (name !== "perClass" && typeof value === "number") counters[name] = value;
    }
    for (const classId of DRESSING_CLASSES) {
      const perClass = this.diagnostics.perClass[classId];
      counters[`dressing_${classId}_generated`] = perClass.generated;
      counters[`dressing_${classId}_accepted`] = perClass.accepted;
      counters[`dressing_${classId}_visible`] = perClass.visible;
    }
  }
}

function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(1, value)));
}

function dressingAttachmentParent(parent: RenderCandidate): AttachmentParent {
  const decay01 = parent.classId.includes("rotten") || parent.classId === "broken_snag"
    ? 0.9
    : parent.classId.includes("mossy") ? 0.55 : 0.15;
  return {
    stableId: parent.stableId,
    transform: {
      position: [parent.x, parent.y, parent.z],
      rotation: [0, Math.sin(parent.yaw * 0.5), 0, Math.cos(parent.yaw * 0.5)],
      scale: [parent.scale, parent.scale, parent.scale],
    },
    age01: decay01,
    health01: Math.max(0, 1 - decay01),
    decay01,
    destroyed: false,
  };
}

function dressingAttachmentAnchor(classId: DressingClassId, slot: number): DressingAttachmentAnchor {
  const kind: DressingAnchorKind = classId === "root_moss" || classId === "root_fern"
    ? "root_flare"
    : classId === "hanging_vine"
      ? "trunk_high"
      : classId === "cap_fungus"
        ? "log_end"
        : classId === "shelf_fungus"
          ? "log_side"
          : "trunk_mid";
  return {
    slot,
    kind,
    positionLocal: [0, 0, 0],
    normalLocal: [0, 1, 0],
    tangentLocal: [1, 0, 0],
    radiusM: 0.4,
    exposure01: 0.35,
  };
}

function configuredDensityPerHectare(classId: DressingClassId, config: DressingConfig): number {
  const densities = config.densities;
  if (classId === "dead_log_fresh") return densities.deadfallPerHectare * 0.25;
  if (classId === "dead_log_mossy") return densities.deadfallPerHectare * 0.4;
  if (classId === "dead_log_rotten") return densities.deadfallPerHectare * 0.35;
  if (classId === "stump_fresh") return densities.stumpsPerHectare * 0.42;
  if (classId === "stump_rotten") return densities.stumpsPerHectare * 0.58;
  if (classId === "broken_snag") return densities.brokenSnagsPerHectare;
  if (classId === "large_driftwood") return densities.driftwoodPer100m * 5;
  if (classId === "large_talus_boulder") return 4;
  if (classId === "moss_patch") return densities.mossPatchesPerHectare;
  if (classId === "lichen_patch") return densities.lichenPatchesPerHectare;
  if (classId === "leaf_litter" || classId === "needle_litter") return densities.litterClustersPerHectare * 0.5;
  if (classId === "twig_cluster") return densities.twigClustersPerHectare;
  if (classId === "river_cobbles") return densities.riverCobbleClustersPer100m * 5;
  if (classId === "small_driftwood") return densities.driftwoodPer100m * 5;
  if (classId === "cave_mouth_fern") return densities.caveMouthFernsPer100m2 * 100;
  if (classId === "bark_chip_cluster") return 90;
  if (classId === "small_talus" || classId === "wet_stone_cluster") return 70;
  if (classId === "bank_fern") return 40;
  if (classId === "cliff_fern") return 24;
  if (classId === "flower_patch") return 80;
  return 0;
}

function persistentSurfaceAccepted(classId: DressingClassId, sample: DressingEnvironmentSample): boolean {
  if (sample.structureExcluded || sample.persistentExcluded) return false;
  if (classId === "large_driftwood") return sample.shoreDistanceM >= 0 && sample.shoreDistanceM <= 3 && sample.normal[1] >= 0.86;
  if (classId === "large_talus_boulder") return sample.materialWeights[1] >= 0.3 && sample.waterDepthM < 0.2;
  return sample.waterDepthM <= 0.12 && sample.normal[1] >= Math.cos(35 * Math.PI / 180);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / Math.max(1e-6, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function geometrySupportOffset(classId: DressingClassId): number {
  if (classId.startsWith("dead_log") || classId.includes("driftwood")) return 0.3;
  if (classId.startsWith("stump")) return 0.325;
  if (classId === "broken_snag") return 1.9;
  if (classId === "large_talus_boulder" || classId === "small_talus") return 0.25;
  if (classId === "river_cobbles" || classId === "wet_stone_cluster") return 0.14;
  if (classId.includes("litter") || classId.includes("patch") || classId === "moss_patch" || classId === "lichen_patch") return 0.015;
  return 0;
}

function createDressingMaterial(classId: DressingClassId): THREE.MeshStandardMaterial {
  const wet = classId === "wet_stone_cluster";
  return new THREE.MeshStandardMaterial({
    color: CLASS_COLORS[classId],
    roughness: wet ? 0.34 : classId.includes("lichen") ? 0.95 : 0.78,
    metalness: 0,
    side: THREE.DoubleSide,
    transparent: classId.includes("fern") || classId.includes("litter") || classId.includes("patch"),
    alphaTest: 0.12,
  });
}

function createDressingGeometry(classId: DressingClassId): THREE.BufferGeometry {
  const family = DRESSING_CLASS_DEFINITIONS[classId].geometryFamily;
  if (family === "dead_log" || family === "driftwood") {
    const geometry = new THREE.CylinderGeometry(0.22, 0.3, family === "driftwood" ? 2.5 : 3.2, 7, 1, false);
    geometry.rotateZ(Math.PI / 2);
    return geometry;
  }
  if (family === "stump") return new THREE.CylinderGeometry(0.33, 0.42, 0.65, 8);
  if (family === "broken_snag") return new THREE.CylinderGeometry(0.17, 0.34, 3.8, 7);
  if (family === "fungus_shelf") {
    const geometry = new THREE.SphereGeometry(0.22, 8, 4, 0, Math.PI, 0, Math.PI / 2);
    geometry.scale(1.4, 0.32, 0.8);
    return geometry;
  }
  if (family === "fungus_cap") {
    const geometry = new THREE.SphereGeometry(0.18, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    geometry.scale(1, 0.35, 1);
    return geometry;
  }
  if (family === "vine") return new THREE.CylinderGeometry(0.018, 0.025, 2.2, 5);
  if (family.includes("fern")) return crossedCards(0.75, 0.85);
  if (family === "river_cobble" || family === "wet_stone" || family === "small_talus") {
    const geometry = new THREE.IcosahedronGeometry(family === "small_talus" ? 0.45 : 0.25, 0);
    geometry.scale(1.2, 0.55, 0.9);
    return geometry;
  }
  if (family === "flower_patch") return crossedCards(0.5, 0.55);
  if (family.includes("litter") || family.includes("cluster") || family.includes("patch")) {
    const geometry = new THREE.CircleGeometry(family.includes("litter") ? 0.75 : 0.55, 7);
    geometry.rotateX(-Math.PI / 2);
    return geometry;
  }
  return crossedCards(0.55, 0.6);
}

function crossedCards(width: number, height: number): THREE.BufferGeometry {
  const positions = new Float32Array([
    -width / 2, 0, 0, width / 2, 0, 0, width / 2, height, 0, -width / 2, height, 0,
    0, 0, -width / 2, 0, 0, width / 2, 0, height, width / 2, 0, height, -width / 2,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  geometry.computeVertexNormals();
  return geometry;
}
