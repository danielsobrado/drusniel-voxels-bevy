import * as THREE from "three";
import { StorageBufferAttribute } from "three/webgpu";
import type { FarClipmapSource } from "./far_clipmap_source.js";
import { getActiveWebGpuRendererContext } from "../../rendering/webgpu_renderer_context.js";
import type { FarClipmapMaterial, FarClipmapSourceTextureStats } from "./far_clipmap_material.js";
import {
  FAR_CLIPMAP_OWNERSHIP_DATA,
  FAR_CLIPMAP_OWNERSHIP_STORAGE,
  FAR_CLIPMAP_SOURCE_DATA,
  FAR_CLIPMAP_SOURCE_STORAGE,
  FAR_CLIPMAP_SOURCE_TEXTURE,
  FAR_CLIPMAP_WATER_DATA,
  FAR_CLIPMAP_WATER_STORAGE,
  FAR_CLIPMAP_WATER_TEXTURE,
} from "./far_clipmap_material_backends.js";

export function disposeFarClipmapMaterialSourceTextures(material: FarClipmapMaterial): void {
  (material.userData[FAR_CLIPMAP_SOURCE_TEXTURE] as THREE.DataTexture | undefined)?.dispose();
  (material.userData[FAR_CLIPMAP_WATER_TEXTURE] as THREE.DataTexture | undefined)?.dispose();
}

function normalizedRefinedPageCoords(keys: readonly string[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const key of keys) {
    const [levelText, coordText] = key.split(":");
    const [xText, zText] = (coordText ?? "").split(",");
    const level = Number(levelText?.startsWith("L") ? levelText.slice(1) : levelText);
    const x = Number(xText);
    const z = Number(zText);
    if (level === 0 && Number.isInteger(x) && Number.isInteger(z)) out.add(`${x},${z}`);
  }
  return out;
}

export function updateFarClipmapMaterialOwnershipMask(material: FarClipmapMaterial, input: {
  gridResolution: number;
  ringOriginX: number;
  ringOriginZ: number;
  cellSizeM: number;
  centerX: number;
  centerZ: number;
  innerRadiusM: number;
  outerRadiusM: number;
  pageSizeM: number;
  readyPageKeys: readonly string[];
} | null): number {
  const data = material.userData[FAR_CLIPMAP_OWNERSHIP_DATA] as Float32Array | undefined;
  const ownershipStorage = material.userData[FAR_CLIPMAP_OWNERSHIP_STORAGE] as StorageBufferAttribute | undefined;
  if (!data || !ownershipStorage) return 0;
  data.fill(0);
  if (!input) {
    ownershipStorage.needsUpdate = true;
    return 0;
  }
  const resolution = Math.max(2, Math.floor(input.gridResolution));
  const pageSizeM = Math.max(1, input.pageSizeM);
  const refinedReady = normalizedRefinedPageCoords(input.readyPageKeys);
  const fallbackOwnsPoint = (worldX: number, worldZ: number): boolean => {
    const distanceM = Math.hypot(worldX - input.centerX, worldZ - input.centerZ);
    if (distanceM < input.innerRadiusM || distanceM >= input.outerRadiusM) return false;
    const px = Math.floor(worldX / pageSizeM);
    const pz = Math.floor(worldZ / pageSizeM);
    return !refinedReady.has(`${px},${pz}`);
  };
  let fallbackVertices = 0;
  for (let z = 0; z < resolution; z++) {
    for (let x = 0; x < resolution; x++) {
      const worldX = input.ringOriginX + x * input.cellSizeM;
      const worldZ = input.ringOriginZ + z * input.cellSizeM;
      let fallbackOwned = false;
      // Ownership is interpolated across the coarse clipmap triangle. Dilate the missing-page
      // complement by one grid cell so the interpolation transition lands under ready CLOD
      // geometry instead of cutting a triangular hole at the exact page boundary.
      for (let oz = -1; oz <= 1 && !fallbackOwned; oz++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (fallbackOwnsPoint(worldX + ox * input.cellSizeM, worldZ + oz * input.cellSizeM)) {
            fallbackOwned = true;
            break;
          }
        }
      }
      if (!fallbackOwned) continue;
      data[z * resolution + x] = 1;
      fallbackVertices++;
    }
  }
  ownershipStorage.needsUpdate = true;
  return fallbackVertices;
}

export function updateFarClipmapMaterialSourceTexture(material: FarClipmapMaterial, input: {
  source: FarClipmapSource;
  gridResolution: number;
  ringOriginX: number;
  ringOriginZ: number;
  cellSizeM: number;
  cameraX: number;
  cameraZ: number;
  clipInnerRadiusM?: number;
  clipOuterRadiusM?: number;
  /** When set, cells without summary tiles that sample below this height become open ocean
   *  (deep-ocean tiles are never built, so without this the horizon renders as dry sea floor). */
  seaLevelM?: number;
  /** Sample cells inside the inner clip radius instead of zeroing them. Required when the
   *  refined-ownership fallback renders there: zeroed cells otherwise draw as a flat
   *  height-0 shelf under missing CLOD pages (the visible near->far seam). */
  includeInnerRadius?: boolean;
  deferUpload?: boolean;
}): FarClipmapSourceTextureStats {
  const sourceTexture = material.userData[FAR_CLIPMAP_SOURCE_TEXTURE] as THREE.DataTexture | undefined;
  const data = material.userData[FAR_CLIPMAP_SOURCE_DATA] as Float32Array | undefined;
  const waterTexture = material.userData[FAR_CLIPMAP_WATER_TEXTURE] as THREE.DataTexture | undefined;
  const waterData = material.userData[FAR_CLIPMAP_WATER_DATA] as Float32Array | undefined;
  const sourceStorage = material.userData[FAR_CLIPMAP_SOURCE_STORAGE] as StorageBufferAttribute | undefined;
  const waterStorage = material.userData[FAR_CLIPMAP_WATER_STORAGE] as StorageBufferAttribute | undefined;
  if (!data || !waterData || (!sourceTexture && !sourceStorage) || (!waterTexture && !waterStorage)) {
    return { fallbackSamples: 0, exceptionSamples: 0 };
  }

  const gridResolution = Math.max(2, Math.floor(input.gridResolution));
  // Inner-radius cells are only rendered where the ownership mask marks them
  // fallback-owned, so restrict the (expensive) inner sampling to those cells.
  // Without mask data yet, sample the whole disc rather than render zeros.
  const ownershipData = input.includeInnerRadius === true
    ? material.userData[FAR_CLIPMAP_OWNERSHIP_DATA] as Float32Array | undefined
    : undefined;
  let fallbackSamples = 0;
  let exceptionSamples = 0;
  const summary = {
    height: 0, normalX: 0, normalY: 1, normalZ: 0, material: 0,
    waterCoverage: 0, waterLevel: 0, bodyKind: 0, shoreDistance: 0,
    unifiedChannels: false,
  };
  for (let z = 0; z < gridResolution; z++) {
    for (let x = 0; x < gridResolution; x++) {
      const worldX = input.ringOriginX + x * input.cellSizeM;
      const worldZ = input.ringOriginZ + z * input.cellSizeM;
      const distanceM = Math.hypot(worldX - input.cameraX, worldZ - input.cameraZ);
      const offset = (z * gridResolution + x) * 4;
      const insideInnerRadius = input.clipInnerRadiusM !== undefined
        && distanceM + input.cellSizeM < input.clipInnerRadiusM;
      const innerFallbackOwned = input.includeInnerRadius === true
        && (ownershipData === undefined || ownershipData[z * gridResolution + x] > 0.5);
      const outsideInnerRadius = insideInnerRadius && !innerFallbackOwned;
      const outsideOuterRadius = input.clipOuterRadiusM !== undefined
        && distanceM > input.clipOuterRadiusM + input.cellSizeM;
      if (outsideInnerRadius || outsideOuterRadius) {
        data[offset] = 0;
        data[offset + 1] = 0;
        data[offset + 2] = 0;
        data[offset + 3] = 0;
        waterData[offset] = 0;
        waterData[offset + 1] = 0;
        waterData[offset + 2] = 0;
        waterData[offset + 3] = -1;
        continue;
      }
      try {
        const hasSummary = input.source.sampleSummaryInto?.(worldX, worldZ, distanceM, summary) === true;
        if (!hasSummary) fallbackSamples++;
        const height = hasSummary ? summary.height : input.source.sampleHeight(worldX, worldZ);
        const normal = hasSummary
          ? { x: summary.normalX, y: summary.normalY, z: summary.normalZ }
          : estimateNormal(input.source, worldX, worldZ, input.cellSizeM);
        // Inside the inner radius the clipmap only backfills missing CLOD pages; sink it
        // below the true surface so any page that did render wins the depth test even
        // where the coarse grid would interpolate above the fine geometry. The sink fades
        // out across one cell at the boundary so the owned band beyond stays exact.
        let renderHeight = height;
        if (input.includeInnerRadius === true && input.clipInnerRadiusM !== undefined && distanceM < input.clipInnerRadiusM) {
          const sink = Math.min(1, (input.clipInnerRadiusM - distanceM) / Math.max(input.cellSizeM, 1));
          renderHeight = height - 4 * sink;
        }
        data[offset] = finiteOr(renderHeight, 0);
        data[offset + 1] = finiteOr(normal.x, 0);
        data[offset + 2] = finiteOr(normal.z, 0);
        data[offset + 3] = finiteOr(hasSummary ? summary.material : input.source.sampleMaterial(worldX, worldZ), 0);
        const oceanFallback = !hasSummary
          && input.seaLevelM !== undefined
          && Number.isFinite(height)
          && height < input.seaLevelM;
        if (oceanFallback) {
          waterData[offset] = input.seaLevelM!;
          waterData[offset + 1] = 1;
          waterData[offset + 2] = 96;
          waterData[offset + 3] = 1;
        } else {
          waterData[offset] = finiteOr(hasSummary ? summary.waterLevel : height, height);
          waterData[offset + 1] = finiteOr(hasSummary ? summary.bodyKind : 0, 0);
          waterData[offset + 2] = finiteOr(hasSummary ? summary.shoreDistance : 0, 0);
          waterData[offset + 3] = hasSummary && summary.unifiedChannels === true
            ? finiteOr(summary.waterCoverage, 0)
            : -1;
        }
      } catch {
        exceptionSamples++;
        data[offset] = 0;
        data[offset + 1] = 0;
        data[offset + 2] = 0;
        data[offset + 3] = 0;
        waterData[offset] = 0;
        waterData[offset + 1] = 0;
        waterData[offset + 2] = 0;
        waterData[offset + 3] = -1;
      }
    }
  }
  smoothFarClipmapLandHeights(data, waterData, gridResolution);
  if (input.deferUpload) return { fallbackSamples, exceptionSamples };
  if (sourceStorage && waterStorage) {
    sourceStorage.needsUpdate = true;
    waterStorage.needsUpdate = true;
  } else {
    sourceTexture!.needsUpdate = true;
    waterTexture!.needsUpdate = true;
  }
  return { fallbackSamples, exceptionSamples };
}

export function smoothFarClipmapLandHeights(
  sourceData: Float32Array,
  waterData: Float32Array,
  gridResolution: number,
): void {
  const resolution = Math.max(2, Math.floor(gridResolution));
  if (resolution < 3) return;
  const originalHeights = new Float32Array(resolution * resolution);
  for (let i = 0; i < originalHeights.length; i++) originalHeights[i] = sourceData[i * 4] ?? 0;

  const dryUnifiedSample = (x: number, z: number): boolean => {
    const coverage = waterData[(z * resolution + x) * 4 + 3] ?? -1;
    return coverage >= 0 && coverage <= 0.04;
  };
  for (let z = 1; z < resolution - 1; z++) {
    for (let x = 1; x < resolution - 1; x++) {
      if (
        !dryUnifiedSample(x, z)
        || !dryUnifiedSample(x - 1, z)
        || !dryUnifiedSample(x + 1, z)
        || !dryUnifiedSample(x, z - 1)
        || !dryUnifiedSample(x, z + 1)
      ) continue;
      const center = z * resolution + x;
      const smoothed = originalHeights[center] * 0.5
        + (originalHeights[center - 1]
          + originalHeights[center + 1]
          + originalHeights[center - resolution]
          + originalHeights[center + resolution]) * 0.125;
      sourceData[center * 4] = smoothed;
    }
  }
}

export function commitFarClipmapMaterialSourceUpdate(
  material: FarClipmapMaterial,
  channel: "source" | "water",
  byteOffset: number,
  maxBytes: number,
): boolean {
  const sourceStorage = material.userData[FAR_CLIPMAP_SOURCE_STORAGE] as StorageBufferAttribute | undefined;
  const waterStorage = material.userData[FAR_CLIPMAP_WATER_STORAGE] as StorageBufferAttribute | undefined;
  if (sourceStorage && waterStorage) {
    const context = getActiveWebGpuRendererContext();
    const backend = context?.renderer.backend as unknown as {
      get(attribute: StorageBufferAttribute): { buffer?: GPUBuffer };
    } | undefined;
    const sourceBuffer = backend?.get(sourceStorage).buffer;
    const waterBuffer = backend?.get(waterStorage).buffer;
    if (context && sourceBuffer && waterBuffer) {
      const attribute = channel === "source" ? sourceStorage : waterStorage;
      const buffer = channel === "source" ? sourceBuffer : waterBuffer;
      const data = attribute.array as Float32Array;
      const bytes = Math.min(maxBytes, data.byteLength - byteOffset);
      context.device.queue.writeBuffer(buffer, byteOffset, data.buffer, data.byteOffset + byteOffset, bytes);
      return byteOffset + bytes >= data.byteLength;
    }
    if (channel === "source") sourceStorage.needsUpdate = true;
    else waterStorage.needsUpdate = true;
    return true;
  }
  const sourceTexture = material.userData[FAR_CLIPMAP_SOURCE_TEXTURE] as THREE.DataTexture | undefined;
  const waterTexture = material.userData[FAR_CLIPMAP_WATER_TEXTURE] as THREE.DataTexture | undefined;
  if (channel === "source" && sourceTexture) sourceTexture.needsUpdate = true;
  if (channel === "water" && waterTexture) waterTexture.needsUpdate = true;
  return true;
}

function estimateNormal(source: FarClipmapSource, x: number, z: number, cellSizeM: number): { x: number; y: number; z: number } {
  const step = Math.max(1, cellSizeM);
  const hL = source.sampleHeight(x - step, z);
  const hR = source.sampleHeight(x + step, z);
  const hD = source.sampleHeight(x, z - step);
  const hU = source.sampleHeight(x, z + step);
  const nx = hL - hR;
  const ny = 2 * step;
  const nz = hD - hU;
  const len = Math.hypot(nx, ny, nz);
  if (!Number.isFinite(len) || len <= 1e-10) return { x: 0, y: 1, z: 0 };
  return { x: nx / len, y: ny / len, z: nz / len };
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
