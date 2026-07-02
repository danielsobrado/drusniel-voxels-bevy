import * as THREE from "three";
import type { FarSummaryTile } from "../types.js";
import type { NaadfWorldState } from "../summaryStreamer.js";
import { materialColorForDebugId } from "../../terrainMaterial/terrainMaterialBands.js";
import type { TerrainMaterialCacheConfig } from "../../terrain/material-cache/terrainMaterialCacheConfig.js";
import { TerrainMaterialCache } from "../../terrain/material-cache/terrainMaterialCache.js";
import { bakeFarSummaryTerrainMaterial } from "../../terrain/material-cache/terrainMaterialBakeProviders.js";
import type { TerrainMaterialBakePayload } from "../../terrain/material-cache/terrainMaterialCacheTypes.js";
import {
  DEFAULT_FAR_SUMMARY_ATLAS_FORMAT,
  clamp01,
  estimateFarSummaryAtlasBytes,
  packUnorm8,
  resolveFarSummaryAtlasPackingSpec,
  type FarSummaryAtlasByteEstimate,
  type FarSummaryAtlasFormat,
  type FarSummaryAtlasPackingSpec,
} from "../farSummaryAtlasPacking.js";

const DEFAULT_ATLAS_TILES_X = 5;
const DEFAULT_ATLAS_TILES_Z = 5;
const RGBA_COMPONENTS = 4;
const NORMAL_ENCODE_BIAS = 0.5;
const NORMAL_ENCODE_SCALE = 0.5;
const HALF_FLOAT_MAX = 65504;

type HeightAtlasData = Float32Array | Uint16Array;
type AtlasData = Float32Array | Uint8Array;

export interface FarSummaryGpuAtlasRingView {
  originX: number;
  originZ: number;
  cellM: number;
  startM: number;
  endM: number;
  rowOffsetCells: number;
  widthCells: number;
  heightCells: number;
  valid: number;
}

export interface FarSummaryGpuAtlasView {
  readonly texture: THREE.DataTexture;
  readonly materialTexture: THREE.DataTexture;
  readonly normalTexture: THREE.DataTexture;
  readonly coverageTexture: THREE.DataTexture;
  readonly rings: FarSummaryGpuAtlasRingView[];
  readonly format?: FarSummaryAtlasFormat;
  readonly estimatedBytes?: number;
  readonly debugEstimatedBytes?: number;
  readonly memorySavingsBytes?: number;
  readonly memorySavingsPct?: number;
  originX: number;
  originZ: number;
  cellM: number;
  widthCells: number;
  heightCells: number;
  valid: number;
  revision: number;
}

export interface FarSummaryGpuAtlasOptions {
  tileCells: number;
  ringCount?: number;
  tilesX?: number;
  tilesZ?: number;
  format?: FarSummaryAtlasFormat;
  materialCache?: TerrainMaterialCache;
  materialCacheConfig?: TerrainMaterialCacheConfig;
}

export class FarSummaryGpuAtlas {
  readonly view: FarSummaryGpuAtlasView;
  private readonly tileCells: number;
  private readonly tilesX: number;
  private readonly tilesZ: number;
  private readonly ringCount: number;
  private readonly ringWidthCells: number;
  private readonly ringHeightCells: number;
  private readonly packing: FarSummaryAtlasPackingSpec;
  private readonly byteEstimate: FarSummaryAtlasByteEstimate;
  private readonly heightData: HeightAtlasData;
  private readonly materialData: AtlasData;
  private readonly normalData: AtlasData;
  private readonly coverageData: AtlasData;
  private readonly materialCache: TerrainMaterialCache | null;
  private readonly materialCacheConfig: TerrainMaterialCacheConfig | null;
  private lastSignature = "";

  constructor(options: FarSummaryGpuAtlasOptions) {
    this.tileCells = Math.max(1, Math.floor(options.tileCells));
    this.tilesX = Math.max(1, Math.floor(options.tilesX ?? DEFAULT_ATLAS_TILES_X));
    this.tilesZ = Math.max(1, Math.floor(options.tilesZ ?? DEFAULT_ATLAS_TILES_Z));
    this.ringCount = Math.max(1, Math.floor(options.ringCount ?? 1));
    this.ringWidthCells = this.tileCells * this.tilesX;
    this.ringHeightCells = this.tileCells * this.tilesZ;
    this.packing = resolveFarSummaryAtlasPackingSpec(options.format ?? DEFAULT_FAR_SUMMARY_ATLAS_FORMAT);
    this.materialCache = options.materialCache ?? null;
    this.materialCacheConfig = options.materialCacheConfig ?? null;

    const width = this.ringWidthCells;
    const height = this.ringHeightCells * this.ringCount;
    this.byteEstimate = estimateFarSummaryAtlasBytes(width, height, this.packing);
    this.heightData = this.packing.heightFormat === "r16f"
      ? new Uint16Array(width * height * this.packing.heightComponents)
      : new Float32Array(width * height * this.packing.heightComponents);
    this.materialData = this.packing.format === "debug_rgba32f"
      ? new Float32Array(width * height * RGBA_COMPONENTS)
      : new Uint8Array(width * height * RGBA_COMPONENTS);
    this.coverageData = this.packing.format === "debug_rgba32f"
      ? new Float32Array(width * height * RGBA_COMPONENTS)
      : new Uint8Array(width * height * RGBA_COMPONENTS);
    const normalPixels = this.packing.storesNormalAtlas ? width * height : 1;
    this.normalData = this.packing.format === "debug_rgba32f"
      ? new Float32Array(normalPixels * RGBA_COMPONENTS)
      : new Uint8Array(normalPixels * RGBA_COMPONENTS);

    const texture = createHeightAtlasTexture(this.heightData, width, height, this.packing, "naadf-far-summary-height-atlas");
    const materialTexture = createPackedAtlasTexture(this.materialData, width, height, this.packing, "naadf-far-summary-material-atlas");
    const normalTexture = createPackedAtlasTexture(
      this.normalData,
      this.packing.storesNormalAtlas ? width : 1,
      this.packing.storesNormalAtlas ? height : 1,
      this.packing,
      "naadf-far-summary-normal-atlas",
    );
    const coverageTexture = createPackedAtlasTexture(this.coverageData, width, height, this.packing, "naadf-far-summary-coverage-atlas");

    this.view = {
      texture,
      materialTexture,
      normalTexture,
      coverageTexture,
      rings: Array.from({ length: this.ringCount }, (_, ringIndex) => this.emptyRingView(ringIndex)),
      format: this.packing.format,
      estimatedBytes: this.byteEstimate.totalBytes,
      debugEstimatedBytes: this.byteEstimate.debugRgba32fBytes,
      memorySavingsBytes: this.byteEstimate.savingsBytes,
      memorySavingsPct: this.byteEstimate.savingsPct,
      originX: 0,
      originZ: 0,
      cellM: 1,
      widthCells: width,
      heightCells: height,
      valid: 0,
      revision: 0,
    };
  }

  updateFromState(state: NaadfWorldState): void {
    if (state.farTiles.size === 0 || state.config.farClipmap.rings.length === 0) {
      this.invalidate();
      return;
    }

    const signatureParts: string[] = [];
    const planned: Array<{
      ringIndex: number;
      minTileX: number;
      minTileZ: number;
      selected: FarSummaryTile[];
    }> = [];

    const maxRings = Math.min(this.ringCount, state.config.farClipmap.rings.length);
    for (let ringIndex = 0; ringIndex < maxRings; ringIndex++) {
      const readyTiles = [...state.farTiles.values()]
        .filter((tile) => tile.key.ring === ringIndex && tile.state === "ready")
        .sort((a, b) => Math.hypot(a.originX - state.predictedX, a.originZ - state.predictedZ)
          - Math.hypot(b.originX - state.predictedX, b.originZ - state.predictedZ));

      if (readyTiles.length === 0) {
        signatureParts.push(`${ringIndex}:missing`);
        planned.push({ ringIndex, minTileX: 0, minTileZ: 0, selected: [] });
        continue;
      }

      const anchor = readyTiles[0]!;
      const minTileX = anchor.key.x - Math.floor(this.tilesX / 2);
      const minTileZ = anchor.key.z - Math.floor(this.tilesZ / 2);
      const selected = selectTiles(readyTiles, minTileX, minTileZ, this.tilesX, this.tilesZ);
      planned.push({ ringIndex, minTileX, minTileZ, selected });
      signatureParts.push(buildRingSignature(ringIndex, selected, minTileX, minTileZ));
    }

    const signature = signatureParts.join(";");
    if (signature === this.lastSignature) return;

    this.heightData.fill(0);
    this.materialData.fill(0);
    this.normalData.fill(0);
    this.coverageData.fill(0);
    let validRings = 0;
    for (let ringIndex = 0; ringIndex < this.ringCount; ringIndex++) {
      const ring = state.config.farClipmap.rings[ringIndex];
      const plan = planned.find((entry) => entry.ringIndex === ringIndex);
      if (!ring || !plan || plan.selected.length === 0) {
        this.view.rings[ringIndex] = this.emptyRingView(ringIndex, ring);
        continue;
      }

      for (const tile of plan.selected) {
        this.blitTile(tile, tile.key.x - plan.minTileX, tile.key.z - plan.minTileZ, ringIndex, state.frame);
      }

      const spanM = ring.cellM * this.tileCells;
      this.view.rings[ringIndex] = {
        originX: plan.minTileX * spanM,
        originZ: plan.minTileZ * spanM,
        cellM: ring.cellM,
        startM: ring.startM,
        endM: ring.endM,
        rowOffsetCells: ringIndex * this.ringHeightCells,
        widthCells: this.ringWidthCells,
        heightCells: this.ringHeightCells,
        valid: 1,
      };
      validRings++;
    }

    const firstValid = this.view.rings.find((ring) => ring.valid > 0) ?? this.view.rings[0]!;
    this.view.originX = firstValid.originX;
    this.view.originZ = firstValid.originZ;
    this.view.cellM = firstValid.cellM;
    this.view.valid = validRings > 0 ? 1 : 0;
    this.view.revision++;
    this.view.texture.needsUpdate = true;
    this.view.materialTexture.needsUpdate = true;
    this.view.normalTexture.needsUpdate = true;
    this.view.coverageTexture.needsUpdate = true;
    this.lastSignature = signature;
  }

  dispose(): void {
    this.view.texture.dispose();
    this.view.materialTexture.dispose();
    this.view.normalTexture.dispose();
    this.view.coverageTexture.dispose();
  }

  private invalidate(): void {
    if (this.view.valid === 0 && this.lastSignature === "") return;
    this.view.valid = 0;
    this.view.revision++;
    this.heightData.fill(0);
    this.materialData.fill(0);
    this.normalData.fill(0);
    this.coverageData.fill(0);
    for (let ringIndex = 0; ringIndex < this.ringCount; ringIndex++) {
      this.view.rings[ringIndex] = this.emptyRingView(ringIndex);
    }
    this.view.texture.needsUpdate = true;
    this.view.materialTexture.needsUpdate = true;
    this.view.normalTexture.needsUpdate = true;
    this.view.coverageTexture.needsUpdate = true;
    this.lastSignature = "";
  }

  private blitTile(tile: FarSummaryTile, tileX: number, tileZ: number, ringIndex: number, frame: number): void {
    if (tileX < 0 || tileZ < 0 || tileX >= this.tilesX || tileZ >= this.tilesZ) return;
    const atlasWidth = this.view.widthCells;
    const baseX = tileX * this.tileCells;
    const baseZ = ringIndex * this.ringHeightCells + tileZ * this.tileCells;
    const copyCells = Math.min(this.tileCells, tile.resolution);
    const baked = this.lookupMaterialBake(tile, frame);

    for (let z = 0; z < copyCells; z++) {
      for (let x = 0; x < copyCells; x++) {
        const src = z * tile.resolution + x;
        const pixel = (baseZ + z) * atlasWidth + baseX + x;
        this.writeHeight(pixel, tile.avgHeight[src] ?? 0, tile.minHeight[src] ?? 0, tile.maxHeight[src] ?? 0);

        if (!this.writeBakedFarColor(baked, src, pixel)) {
          const color = materialColorForDebugId(tile.dominantMaterial[src] ?? 0);
          this.writeRgba(this.materialData, pixel * RGBA_COMPONENTS, color[0], color[1], color[2], 1);
        }

        if (this.packing.storesNormalAtlas) {
          const normal = deriveSummaryNormal(tile, x, z);
          this.writeRgba(
            this.normalData,
            pixel * RGBA_COMPONENTS,
            encodeNormalChannel(normal.x),
            encodeNormalChannel(normal.y),
            encodeNormalChannel(normal.z),
            1,
          );
        }

        if (!this.writeBakedCoverage(baked, src, pixel)) {
          this.writeRgba(
            this.coverageData,
            pixel * RGBA_COMPONENTS,
            clamp01(tile.canopyCoverage[src] ?? 0),
            clamp01(tile.waterCoverage[src] ?? 0),
            1,
            1,
          );
        }
      }
    }
  }

  private lookupMaterialBake(tile: FarSummaryTile, frame: number): TerrainMaterialBakePayload | null {
    if (!this.materialCache || !this.materialCacheConfig?.bake.bakeFarTiles) return null;
    const key = {
      sourceKind: "far_tile" as const,
      sourceId: `ring:${tile.key.ring}:${tile.key.x},${tile.key.z}`,
      sourceRevision: tile.revision,
      materialRevision: 0,
      waterRevision: 0,
      vegetationCoverageRevision: 0,
      bakeMode: "far_summary_tile" as const,
      resolution: tile.resolution,
      formatProfile: this.materialCacheFormatProfile(),
    };
    const lookup = this.materialCache.getOrQueue(
      key,
      () => bakeFarSummaryTerrainMaterial({ tile }, this.materialCacheConfig!),
      frame,
    );
    if (lookup.kind === "ready") return lookup.entry.payload;
    return lookup.staleEntry?.payload ?? null;
  }

  private materialCacheFormatProfile(): string {
    const cfg = this.materialCacheConfig;
    if (!cfg) return "none";
    return [
      cfg.formats.macroTint,
      cfg.formats.slopeCurvature,
      cfg.formats.materialWeights,
      cfg.formats.wetnessShoreline,
      cfg.formats.farColor,
      cfg.formats.farNormal,
      cfg.formats.coverage,
    ].join(",");
  }

  private writeBakedFarColor(payload: TerrainMaterialBakePayload | null, srcPixel: number, atlasPixel: number): boolean {
    const channel = payload?.farColor;
    if (!channel?.available) return false;
    const src = srcPixel * RGBA_COMPONENTS;
    const dst = atlasPixel * RGBA_COMPONENTS;
    this.writeRgba(
      this.materialData,
      dst,
      (channel.data[src] ?? 0) / 255,
      (channel.data[src + 1] ?? 0) / 255,
      (channel.data[src + 2] ?? 0) / 255,
      (channel.data[src + 3] ?? 255) / 255,
    );
    return true;
  }

  private writeBakedCoverage(payload: TerrainMaterialBakePayload | null, srcPixel: number, atlasPixel: number): boolean {
    const channel = payload?.coverage;
    if (!channel?.available) return false;
    const src = srcPixel * 2;
    const dst = atlasPixel * RGBA_COMPONENTS;
    this.writeRgba(
      this.coverageData,
      dst,
      (channel.data[src] ?? 0) / 255,
      (channel.data[src + 1] ?? 0) / 255,
      1,
      1,
    );
    return true;
  }

  private writeHeight(pixel: number, avgHeight: number, minHeight: number, maxHeight: number): void {
    const dst = pixel * this.packing.heightComponents;
    if (this.heightData instanceof Uint16Array) {
      this.heightData[dst] = THREE.DataUtils.toHalfFloat(clampHalfFloatHeight(avgHeight));
      return;
    }
    this.heightData[dst] = finiteOrZero(avgHeight);
    if (!this.packing.storesHeightRange) return;
    this.heightData[dst + 1] = finiteOrZero(minHeight);
    this.heightData[dst + 2] = finiteOrZero(maxHeight);
    this.heightData[dst + 3] = 1;
  }

  private writeRgba(data: AtlasData, dst: number, r: number, g: number, b: number, a: number): void {
    if (data instanceof Float32Array) {
      data[dst] = clamp01(r);
      data[dst + 1] = clamp01(g);
      data[dst + 2] = clamp01(b);
      data[dst + 3] = clamp01(a);
      return;
    }
    data[dst] = packUnorm8(r);
    data[dst + 1] = packUnorm8(g);
    data[dst + 2] = packUnorm8(b);
    data[dst + 3] = packUnorm8(a);
  }

  private emptyRingView(ringIndex: number, ring?: { startM: number; endM: number; cellM: number }): FarSummaryGpuAtlasRingView {
    return {
      originX: 0,
      originZ: 0,
      cellM: ring?.cellM ?? 1,
      startM: ring?.startM ?? 0,
      endM: ring?.endM ?? 0,
      rowOffsetCells: ringIndex * this.ringHeightCells,
      widthCells: this.ringWidthCells,
      heightCells: this.ringHeightCells,
      valid: 0,
    };
  }
}

function createHeightAtlasTexture(
  data: HeightAtlasData,
  width: number,
  height: number,
  packing: FarSummaryAtlasPackingSpec,
  name: string,
): THREE.DataTexture {
  const format = packing.format === "debug_rgba32f" ? THREE.RGBAFormat : THREE.RedFormat;
  const type = packing.heightFormat === "r16f" ? THREE.HalfFloatType : THREE.FloatType;
  return createAtlasTexture(data, width, height, format, type, name);
}

function createPackedAtlasTexture(
  data: AtlasData,
  width: number,
  height: number,
  packing: FarSummaryAtlasPackingSpec,
  name: string,
): THREE.DataTexture {
  const type = packing.format === "debug_rgba32f" ? THREE.FloatType : THREE.UnsignedByteType;
  return createAtlasTexture(data, width, height, THREE.RGBAFormat, type, name);
}

function createAtlasTexture(
  data: HeightAtlasData | AtlasData,
  width: number,
  height: number,
  format: THREE.PixelFormat,
  type: THREE.TextureDataType,
  name: string,
): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, width, height, format, type);
  texture.name = name;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function deriveSummaryNormal(tile: FarSummaryTile, x: number, z: number): THREE.Vector3 {
  const x0 = Math.max(0, x - 1);
  const x1 = Math.min(tile.resolution - 1, x + 1);
  const z0 = Math.max(0, z - 1);
  const z1 = Math.min(tile.resolution - 1, z + 1);
  const dx = Math.max(1, x1 - x0) * tile.cellM;
  const dz = Math.max(1, z1 - z0) * tile.cellM;
  const dhdx = (heightAt(tile, x1, z) - heightAt(tile, x0, z)) / dx;
  const dhdz = (heightAt(tile, x, z1) - heightAt(tile, x, z0)) / dz;
  return new THREE.Vector3(-dhdx, 1, -dhdz).normalize();
}

function heightAt(tile: FarSummaryTile, x: number, z: number): number {
  const cx = Math.min(tile.resolution - 1, Math.max(0, x));
  const cz = Math.min(tile.resolution - 1, Math.max(0, z));
  return tile.avgHeight[cz * tile.resolution + cx] ?? 0;
}

function encodeNormalChannel(value: number): number {
  return clamp01(value * NORMAL_ENCODE_SCALE + NORMAL_ENCODE_BIAS);
}

function clampHalfFloatHeight(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(HALF_FLOAT_MAX, Math.max(-HALF_FLOAT_MAX, value));
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function selectTiles(
  tiles: FarSummaryTile[],
  minTileX: number,
  minTileZ: number,
  tilesX: number,
  tilesZ: number,
): FarSummaryTile[] {
  return tiles.filter((tile) =>
    tile.key.x >= minTileX
    && tile.key.x < minTileX + tilesX
    && tile.key.z >= minTileZ
    && tile.key.z < minTileZ + tilesZ,
  );
}

function buildRingSignature(
  ringIndex: number,
  tiles: FarSummaryTile[],
  minTileX: number,
  minTileZ: number,
): string {
  const tileSig = tiles
    .map((tile) => `${tile.key.x},${tile.key.z},${tile.revision}`)
    .sort()
    .join("|");
  return `${ringIndex}:${minTileX}:${minTileZ}:${tileSig}`;
}
