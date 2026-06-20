import * as THREE from "three";
import { StorageBufferAttribute, StorageInstancedBufferAttribute } from "three/webgpu";
import {
  GRASS_GPU_RING_CELL,
  GRASS_GPU_RING_GRID,
  type GrassGpuRingOutputBuffers,
  type GrassGpuTierOutputBuffers,
} from "../gpu/grass_ring_compute.js";
import {
  RING_MAX_AXIS_CELLS,
  TWO_PI,
  type GrassSettings,
  type GrassTier,
} from "./grass_config.js";
import type { GrassBladeInstance } from "./grass_cpu_patch.js";
import { edgeFadeForCandidate } from "./grass_cpu_patch.js";
import type { GrassGenerationStats } from "./grass_stats.js";
import { acceptsGrassCandidate, grassRingBands, grassThin, hash2, randomSigned, sampleGrassTerrainSite } from "./grass_math.js";

interface GrassRingTierInstances {
  near: GrassBladeInstance[];
  mid: GrassBladeInstance[];
  far: GrassBladeInstance[];
  super: GrassBladeInstance[];
}

export interface GrassRingGenerationResult extends GrassRingTierInstances {
  stats: GrassGenerationStats;
  cellSize: number;
  radius: number;
  centerCellX: number;
  centerCellZ: number;
}

export interface GrassWebGpuBackendAccess {
  createStorageAttribute(attribute: THREE.BufferAttribute): void;
  createIndirectStorageAttribute(attribute: THREE.BufferAttribute): void;
  get(attribute: THREE.BufferAttribute): { buffer?: GPUBuffer };
}

export interface GrassGpuTierDrawResources {
  mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>;
  offset: StorageInstancedBufferAttribute;
  packed0: StorageInstancedBufferAttribute;
  packed1: StorageInstancedBufferAttribute;
  terrainNormal: StorageInstancedBufferAttribute;
}

export type GrassGpuSharedDrawAttributes = Omit<GrassGpuTierDrawResources, "mesh">;

/**
 * GPU-ring per-instance storage buffers handed to the node material. They hold 4*maxInstancesPerTier
 * vec4 and must be read as storage (storage().element), never via attribute() - that exceeds the
 * 64KB uniform-binding limit on the indirect-draw path. See grass_node_material.ts.
 */
export type GrassRingInstanceBuffers = GrassGpuSharedDrawAttributes & {
  /** vec4 element count of each buffer = sharedInstanceCount = 4 * maxInstancesPerTier */
  capacity: number;
};

export type IndirectInstancedBufferGeometry = THREE.InstancedBufferGeometry & {
  setIndirect?(attribute: THREE.BufferAttribute, offset: number): void;
};

export function grassGpuRingDrawUnsupportedReason(): string | null {
  const prototype = THREE.InstancedBufferGeometry.prototype as IndirectInstancedBufferGeometry;
  return typeof prototype.setIndirect === "function"
    ? null
    : "webgpu-ring-v1 requires InstancedBufferGeometry.setIndirect support";
}

export interface GrassGpuRingDrawResources {
  tiers: Record<GrassTier, GrassGpuTierDrawResources>;
  indirect: StorageBufferAttribute;
  outputBuffers: GrassGpuRingOutputBuffers;
}

export function ringCellSize(settings: GrassSettings, radius: number): number {
  return Math.max(0.5, settings.bladeSpacing, (radius * 2) / RING_MAX_AXIS_CELLS);
}

export function grassGpuRingKey(settings: GrassSettings, worldCells: number): string {
  return [
    worldCells,
    settings.maxBlades,
    GRASS_GPU_RING_GRID,
    GRASS_GPU_RING_CELL,
  ].join("|");
}

export function grassGpuRingTierCapacity(settings: GrassSettings): number {
  return Math.max(0, Math.floor(settings.maxBlades));
}

export function gpuBuffersForTier(
  tier: GrassGpuSharedDrawAttributes,
  bufferForAttribute: (attribute: THREE.BufferAttribute) => GPUBuffer,
): GrassGpuTierOutputBuffers {
  return {
    offset: bufferForAttribute(tier.offset),
    packed0: bufferForAttribute(tier.packed0),
    packed1: bufferForAttribute(tier.packed1),
    terrainNormal: bufferForAttribute(tier.terrainNormal),
  };
}

export function generateGrassRingInstances(
  center: Pick<THREE.Vector3, "x" | "z">,
  settings: GrassSettings,
  worldCells: number,
  maxBlades = settings.maxBlades,
): GrassRingGenerationResult {
  const bands = grassRingBands(settings);
  const radius = bands.radius;
  const cellSize = ringCellSize(settings, radius);
  const centerCellX = Math.floor(center.x / cellSize);
  const centerCellZ = Math.floor(center.z / cellSize);
  const cellRadius = Math.ceil(radius / cellSize);
  const nearDistance = bands.near;
  const midDistance = bands.mid;
  const farDistance = bands.far;
  const stats: GrassGenerationStats = {
    generatedCandidates: 0,
    acceptedCandidates: 0,
    edgeSuppressedCandidates: 0,
  };
  const ranked: {
    priority: number;
    tier: GrassTier;
    instance: GrassBladeInstance;
  }[] = [];

  for (let dz = -cellRadius; dz <= cellRadius; dz++) {
    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
      stats.generatedCandidates++;
      const cellX = centerCellX + dx;
      const cellZ = centerCellZ + dz;
      const jitterX = randomSigned(cellX, cellZ, settings.seed + 1103) * cellSize * 0.42;
      const jitterZ = randomSigned(cellX, cellZ, settings.seed + 1201) * cellSize * 0.42;
      const x = THREE.MathUtils.clamp((cellX + 0.5) * cellSize + jitterX, 0.001, worldCells - 0.001);
      const z = THREE.MathUtils.clamp((cellZ + 0.5) * cellSize + jitterZ, 0.001, worldCells - 0.001);
      const distance = Math.hypot(center.x - x, center.z - z);
      if (distance > radius || x <= 0 || z <= 0 || x >= worldCells || z >= worldCells) continue;

      const site = sampleGrassTerrainSite(x, z, settings, distance);
      if (!acceptsGrassCandidate(settings, {
        height: site.height,
        normalY: site.normalY,
        grassWeight: site.grassMask,
        waterDepth: site.waterDepth,
        rockWeight: site.rockWeight,
        snowWeight: site.snowWeight,
        threshold: hash2(cellX, cellZ, settings.seed + 1301),
      })) continue;

      const edgeFade = edgeFadeForCandidate(x, z, site.height, site.normalY, cellSize);
      if (edgeFade < 0.18) {
        stats.edgeSuppressedCandidates++;
        continue;
      }

      const thin = grassThin(distance);
      const ringEdge = 1 - THREE.MathUtils.smoothstep(distance, radius * 0.9, radius);
      if (hash2(cellX, cellZ, settings.seed + 1409) >= site.grassMask * edgeFade * thin * ringEdge) continue;

      stats.acceptedCandidates++;
      const heightScale = Math.max(
        0.1,
        1 + randomSigned(cellX, cellZ, settings.seed + 1501) * settings.bladeHeightVariation,
      );
      const widthScale = THREE.MathUtils.clamp(1 / Math.sqrt(thin), 1, 4);
      const tier: GrassTier = distance <= nearDistance
        ? "near"
        : distance <= midDistance ? "mid" : distance <= farDistance ? "far" : "super";
      const tierHeight = tier === "near" ? 1 : tier === "mid" ? 1.35 : tier === "far" ? 1.75 : 2.25;
      ranked.push({
        priority: hash2(cellX, cellZ, settings.seed + 1601),
        tier,
        instance: {
          offset: [x, site.height + 0.02, z],
          height: settings.bladeHeight * heightScale * tierHeight,
          rotationY: hash2(cellX, cellZ, settings.seed + 1709) * TWO_PI,
          phase: hash2(cellX, cellZ, settings.seed + 1801) * TWO_PI,
          colorMix: Math.min(1, Math.pow(hash2(cellX, cellZ, settings.seed + 1901), 2) + site.wetBank * 0.16 + site.sandWeight * 0.12),
          edgeFade,
          normalY: site.normalY,
          terrainNormal: site.terrainNormal,
          widthScale: tier === "super" ? Math.min(4.8, widthScale * 1.35) : widthScale,
        },
      });
    }
  }

  ranked.sort((a, b) => a.priority - b.priority);
  const limit = Math.max(0, Math.floor(maxBlades));
  const tiers: GrassRingTierInstances = { near: [], mid: [], far: [], super: [] };
  for (let i = 0; i < ranked.length && i < limit; i++) {
    const item = ranked[i];
    tiers[item.tier].push(item.instance);
  }

  return {
    ...tiers,
    stats,
    cellSize,
    radius,
    centerCellX,
    centerCellZ,
  };
}

