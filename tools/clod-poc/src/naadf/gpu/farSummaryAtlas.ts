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
  resolveFarSummaryAtlasPackingSpec,
  type FarSummaryAtlasByteEstimate,
  type FarSummaryAtlasFormat,
  type FarSummaryAtlasPackingSpec,
} from "../farSummaryAtlasPacking.js";
import {
  resolveFarSummaryGpuAtlasUploadOptions,
  type FarSummaryGpuAtlasUploadOptions,
  type ResolvedFarSummaryGpuAtlasUploadOptions,
} from "../farSummaryAtlasUploadConfig.js";
import {
  type AtlasDirtyRect,
  type AtlasDirtyUploadPlan,
  type AtlasPlacementDiff,
  type FarSummaryGpuAtlasFullUploadReason,
  type PlannedAtlasTileSnapshot,
  clipRect,
  diffAtlasTilePlacements,
  dirtyArea,
  mergeDirtyRects,
  resolveFullUploadReason,
  shouldUseFullUpload,
} from "./farSummaryAtlasDirtyRects.js";
import {
  RGBA_COMPONENTS,
  clearRectData,
  deriveSummaryNormal,
  encodeNormalChannel,
  writeCoverage,
  writeHeight,
  writeRgba,
} from "./farSummaryAtlasBlit.js";
import {
  type AtlasData,
  type HeightAtlasData,
  createCoverageAtlasTexture,
  createHeightAtlasTexture,
  createPackedAtlasTexture,
} from "./farSummaryAtlasTextures.js";

const DEFAULT_ATLAS_TILES_X = 5;
const DEFAULT_ATLAS_TILES_Z = 5;

type UploadMode = "none" | "dirty" | "full";

export type {
  AtlasDirtyRect,
  AtlasDirtyUploadPlan,
  AtlasPlacementDiff,
  FarSummaryGpuAtlasFullUploadReason,
  PlannedAtlasTileSnapshot,
};
export {
  diffAtlasTilePlacements,
  dirtyArea,
  mergeDirtyRects,
  resolveFullUploadReason,
  shouldUseFullUpload,
};
export type { FarSummaryGpuAtlasUploadOptions } from "../farSummaryAtlasUploadConfig.js";

export interface FarSummaryGpuAtlasUploadStats {
  fullUploads: number;
  dirtyUploads: number;
  dirtyRects: number;
  dirtyPixels: number;
  dirtyPct: number;
  totalPixels: number;
  lastUploadMode: UploadMode;
  fallbackReason: FarSummaryGpuAtlasFullUploadReason | null;
}

interface PlannedAtlasTile extends PlannedAtlasTileSnapshot {
  tile: FarSummaryTile;
}

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
  readonly uploadStats: FarSummaryGpuAtlasUploadStats;
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
  uploadOptions?: FarSummaryGpuAtlasUploadOptions;
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
  private readonly uploadOptions: ResolvedFarSummaryGpuAtlasUploadOptions;
  private readonly previousTilePlacements = new Map<string, PlannedAtlasTileSnapshot>();
  private lastSignature = "";

  constructor(options: FarSummaryGpuAtlasOptions) {
    this.tileCells = Math.max(1, Math.floor(options.tileCells));
    this.tilesX = Math.max(1, Math.floor(options.tilesX ?? DEFAULT_ATLAS_TILES_X));
    this.tilesZ = Math.max(1, Math.floor(options.tilesZ ?? DEFAULT_ATLAS_TILES_Z));
    this.ringCount = Math.max(1, Math.floor(options.ringCount ?? 1));
    this.ringWidthCells = this.tileCells * this.tilesX;
    this.ringHeightCells = this.tileCells * this.tilesZ;
    this.packing = resolveFarSummaryAtlasPackingSpec(options.format ?? DEFAULT_FAR_SUMMARY_ATLAS_FORMAT);
    this.uploadOptions = resolveFarSummaryGpuAtlasUploadOptions(options.uploadOptions);
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
      ? new Float32Array(width * height * this.packing.coverageComponents)
      : new Uint8Array(width * height * this.packing.coverageComponents);
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
    const coverageTexture = createCoverageAtlasTexture(this.coverageData, width, height, this.packing, "naadf-far-summary-coverage-atlas");

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
      uploadStats: {
        fullUploads: 0,
        dirtyUploads: 0,
        dirtyRects: 0,
        dirtyPixels: 0,
        dirtyPct: 0,
        totalPixels: width * height,
        lastUploadMode: "none",
        fallbackReason: null,
      },
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
      selected: PlannedAtlasTile[];
    }> = [];
    const plannedTiles = new Map<string, PlannedAtlasTile>();
    const nextPlacements = new Map<string, PlannedAtlasTileSnapshot>();

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
      const selected = selectTiles(readyTiles, minTileX, minTileZ, this.tilesX, this.tilesZ)
        .map((tile) => this.planTile(tile, minTileX, minTileZ, ringIndex));
      for (const tile of selected) {
        plannedTiles.set(tile.key, tile);
        nextPlacements.set(tile.key, snapshotPlannedTile(tile));
      }
      planned.push({ ringIndex, minTileX, minTileZ, selected });
      signatureParts.push(buildRingSignature(ringIndex, selected.map((entry) => entry.tile), minTileX, minTileZ));
    }

    const signature = signatureParts.join(";");
    if (signature === this.lastSignature) return;

    const initialUpload = this.lastSignature === "" && this.previousTilePlacements.size === 0;
    const forceBlitAll = this.lastSignature === "" && this.previousTilePlacements.size > 0;
    const diff = diffAtlasTilePlacements(this.previousTilePlacements, nextPlacements, forceBlitAll);
    const plannedBlitRects = diff.blitKeys
      .map((key) => plannedTiles.get(key))
      .filter((tile): tile is PlannedAtlasTile => tile !== undefined)
      .map((tile) => plannedTileRect(tile));
    const uploadRects = mergeDirtyRects([...diff.clearRects, ...plannedBlitRects]);
    const uploadPlan: AtlasDirtyUploadPlan = {
      rects: uploadRects,
      dirtyPixels: dirtyArea(uploadRects),
      fullUpload: false,
    };
    const atlasPixels = this.view.widthCells * this.view.heightCells;
    const fallbackReason = initialUpload
      ? "initial" as const
      : resolveFullUploadReason(uploadPlan, atlasPixels, this.uploadOptions, this.activeTexturesSupportDirtyRanges());

    let validRings = 0;
    for (let ringIndex = 0; ringIndex < this.ringCount; ringIndex++) {
      const ring = state.config.farClipmap.rings[ringIndex];
      const plan = planned.find((entry) => entry.ringIndex === ringIndex);
      if (!ring || !plan || plan.selected.length === 0) {
        this.view.rings[ringIndex] = this.emptyRingView(ringIndex, ring);
        continue;
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

    if (fallbackReason) {
      this.clearAllData();
      for (const tile of plannedTiles.values()) {
        this.blitTile(tile.tile, tile.atlasTileX, tile.atlasTileZ, tile.ringIndex, state.frame);
      }
      this.markFullTexturesDirty();
      this.recordUploadStats("full", atlasPixels, atlasPixels, 1, fallbackReason);
    } else if (uploadRects.length > 0) {
      for (const rect of diff.clearRects) this.clearRect(rect);
      const actualBlitRects: AtlasDirtyRect[] = [];
      for (const key of diff.blitKeys) {
        const tile = plannedTiles.get(key);
        if (!tile) continue;
        const rect = this.blitTile(tile.tile, tile.atlasTileX, tile.atlasTileZ, tile.ringIndex, state.frame);
        if (rect) actualBlitRects.push(rect);
      }
      const actualUploadRects = mergeDirtyRects([...diff.clearRects, ...actualBlitRects]);
      const actualDirtyPixels = dirtyArea(actualUploadRects);
      const dirtyUploaded = this.applyActiveTextureDirtyRects(actualUploadRects);
      if (dirtyUploaded) {
        this.recordUploadStats("dirty", actualDirtyPixels, atlasPixels, actualUploadRects.length, null);
      } else {
        this.markFullTexturesDirty();
        this.recordUploadStats("full", atlasPixels, atlasPixels, 1, "partial_ranges_unsupported");
      }
    } else {
      this.recordUploadStats("none", 0, atlasPixels, 0, null);
    }

    const firstValid = this.view.rings.find((ring) => ring.valid > 0) ?? this.view.rings[0]!;
    this.view.originX = firstValid.originX;
    this.view.originZ = firstValid.originZ;
    this.view.cellM = firstValid.cellM;
    this.view.valid = validRings > 0 ? 1 : 0;
    this.view.revision++;
    this.previousTilePlacements.clear();
    for (const [key, tile] of nextPlacements) this.previousTilePlacements.set(key, tile);
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
    this.clearAllData();
    for (let ringIndex = 0; ringIndex < this.ringCount; ringIndex++) {
      this.view.rings[ringIndex] = this.emptyRingView(ringIndex);
    }
    this.markFullTexturesDirty();
    this.previousTilePlacements.clear();
    this.lastSignature = "";
    const atlasPixels = this.view.widthCells * this.view.heightCells;
    this.recordUploadStats("full", atlasPixels, atlasPixels, 1, "full_invalidation");
  }

  private planTile(tile: FarSummaryTile, minTileX: number, minTileZ: number, ringIndex: number): PlannedAtlasTile {
    const atlasTileX = tile.key.x - minTileX;
    const atlasTileZ = tile.key.z - minTileZ;
    const atlasX = atlasTileX * this.tileCells;
    const atlasY = ringIndex * this.ringHeightCells + atlasTileZ * this.tileCells;
    return {
      key: farTilePlacementKey(tile),
      revision: tile.revision,
      ringIndex,
      atlasTileX,
      atlasTileZ,
      atlasX,
      atlasY,
      copyCells: Math.min(this.tileCells, tile.resolution),
      tile,
    };
  }

  private clearAllData(): void {
    this.heightData.fill(0);
    this.materialData.fill(0);
    this.coverageData.fill(0);
    if (this.packing.storesNormalAtlas) this.normalData.fill(0);
  }

  private clearRect(rect: AtlasDirtyRect): void {
    const clipped = clipRect(rect, this.view.widthCells, this.view.heightCells);
    if (!clipped) return;
    clearRectData(this.heightData, clipped, this.view.widthCells, this.packing.heightComponents);
    clearRectData(this.materialData, clipped, this.view.widthCells, RGBA_COMPONENTS);
    clearRectData(this.coverageData, clipped, this.view.widthCells, this.packing.coverageComponents);
    if (this.packing.storesNormalAtlas) {
      clearRectData(this.normalData, clipped, this.view.widthCells, RGBA_COMPONENTS);
    }
  }

  private blitTile(tile: FarSummaryTile, tileX: number, tileZ: number, ringIndex: number, frame: number): AtlasDirtyRect | null {
    if (tileX < 0 || tileZ < 0 || tileX >= this.tilesX || tileZ >= this.tilesZ) return null;
    const atlasWidth = this.view.widthCells;
    const baseX = tileX * this.tileCells;
    const baseZ = ringIndex * this.ringHeightCells + tileZ * this.tileCells;
    const copyCells = Math.min(this.tileCells, tile.resolution);
    const baked = this.lookupMaterialBake(tile, frame);

    for (let z = 0; z < copyCells; z++) {
      for (let x = 0; x < copyCells; x++) {
        const src = z * tile.resolution + x;
        const pixel = (baseZ + z) * atlasWidth + baseX + x;
        writeHeight(this.heightData, this.packing, pixel, tile.avgHeight[src] ?? 0, tile.minHeight[src] ?? 0, tile.maxHeight[src] ?? 0);

        if (!this.writeBakedFarColor(baked, src, pixel)) {
          const color = materialColorForDebugId(tile.dominantMaterial[src] ?? 0);
          writeRgba(this.materialData, pixel * RGBA_COMPONENTS, color[0], color[1], color[2], 1);
        }

        if (this.packing.storesNormalAtlas) {
          const normal = deriveSummaryNormal(tile, x, z);
          writeRgba(
            this.normalData,
            pixel * RGBA_COMPONENTS,
            encodeNormalChannel(normal.x),
            encodeNormalChannel(normal.y),
            encodeNormalChannel(normal.z),
            1,
          );
        }

        if (!this.writeBakedCoverage(baked, src, pixel)) {
          writeCoverage(
            this.coverageData,
            this.packing,
            pixel,
            clamp01(tile.canopyCoverage[src] ?? 0),
            clamp01(tile.waterCoverage[src] ?? 0),
          );
        }
      }
    }

    return { x: baseX, y: baseZ, width: copyCells, height: copyCells };
  }

  private markFullTexturesDirty(): void {
    for (const texture of this.activeAtlasTextures()) markTextureFullyDirty(texture);
  }

  private activeAtlasTextures(): THREE.DataTexture[] {
    const textures = [this.view.texture, this.view.materialTexture, this.view.coverageTexture];
    if (this.packing.storesNormalAtlas) textures.push(this.view.normalTexture);
    return textures;
  }

  private activeTexturesSupportDirtyRanges(): boolean {
    return this.activeAtlasTextures().every(textureUpdateRangesAvailable);
  }

  private applyActiveTextureDirtyRects(rects: AtlasDirtyRect[]): boolean {
    if (rects.length === 0) return true;
    if (!this.activeTexturesSupportDirtyRanges()) return false;
    return this.applyTextureDirtyRects(this.view.texture, rects, this.view.widthCells, this.packing.heightComponents)
      && this.applyTextureDirtyRects(this.view.materialTexture, rects, this.view.widthCells, RGBA_COMPONENTS)
      && (!this.packing.storesNormalAtlas || this.applyTextureDirtyRects(this.view.normalTexture, rects, this.view.widthCells, RGBA_COMPONENTS))
      && this.applyTextureDirtyRects(this.view.coverageTexture, rects, this.view.widthCells, this.packing.coverageComponents);
  }

  private applyTextureDirtyRects(texture: THREE.DataTexture, rects: AtlasDirtyRect[], atlasWidth: number, componentStride: number): boolean {
    if (rects.length === 0) return true;
    if (!textureUpdateRangesAvailable(texture)) return false;

    texture.clearUpdateRanges();
    for (const rect of rects) {
      const clipped = clipRect(rect, atlasWidth, texture.image.height);
      if (!clipped) continue;
      for (let row = 0; row < clipped.height; row++) {
        const pixel = (clipped.y + row) * atlasWidth + clipped.x;
        texture.addUpdateRange(pixel * componentStride, clipped.width * componentStride);
      }
    }
    if (texture.updateRanges.length === 0) return false;
    texture.needsUpdate = true;
    return true;
  }

  private recordUploadStats(
    mode: UploadMode,
    dirtyPixels: number,
    atlasPixels: number,
    rectCount: number,
    fallbackReason: FarSummaryGpuAtlasFullUploadReason | null,
  ): void {
    const stats = this.view.uploadStats;
    if (mode === "full") stats.fullUploads++;
    if (mode === "dirty") stats.dirtyUploads++;
    stats.dirtyPixels = dirtyPixels;
    stats.dirtyRects = rectCount;
    stats.totalPixels = atlasPixels;
    stats.dirtyPct = atlasPixels > 0 ? dirtyPixels / atlasPixels : 0;
    stats.lastUploadMode = mode;
    stats.fallbackReason = fallbackReason;
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
    writeRgba(
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
    writeCoverage(
      this.coverageData,
      this.packing,
      atlasPixel,
      (channel.data[src] ?? 0) / 255,
      (channel.data[src + 1] ?? 0) / 255,
    );
    return true;
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

function farTilePlacementKey(tile: FarSummaryTile): string {
  return `${tile.key.ring}:${tile.key.x}:${tile.key.z}`;
}

function snapshotPlannedTile(tile: PlannedAtlasTile): PlannedAtlasTileSnapshot {
  return {
    key: tile.key,
    revision: tile.revision,
    ringIndex: tile.ringIndex,
    atlasTileX: tile.atlasTileX,
    atlasTileZ: tile.atlasTileZ,
    atlasX: tile.atlasX,
    atlasY: tile.atlasY,
    copyCells: tile.copyCells,
  };
}

function plannedTileRect(tile: PlannedAtlasTile): AtlasDirtyRect {
  return { x: tile.atlasX, y: tile.atlasY, width: tile.copyCells, height: tile.copyCells };
}

function textureUpdateRangesAvailable(texture: THREE.DataTexture): boolean {
  return typeof texture.addUpdateRange === "function"
    && typeof texture.clearUpdateRanges === "function"
    && Array.isArray(texture.updateRanges);
}

function markTextureFullyDirty(texture: THREE.DataTexture): void {
  if (typeof texture.clearUpdateRanges === "function") texture.clearUpdateRanges();
  texture.needsUpdate = true;
}

function selectTiles(tiles: FarSummaryTile[], minTileX: number, minTileZ: number, tilesX: number, tilesZ: number): FarSummaryTile[] {
  return tiles.filter((tile) => tile.key.x >= minTileX
    && tile.key.x < minTileX + tilesX
    && tile.key.z >= minTileZ
    && tile.key.z < minTileZ + tilesZ);
}

function buildRingSignature(ringIndex: number, tiles: FarSummaryTile[], minTileX: number, minTileZ: number): string {
  const tileSig = tiles
    .map((tile) => `${tile.key.x},${tile.key.z}@${tile.revision}`)
    .sort()
    .join("|");
  return `${ringIndex}:${minTileX},${minTileZ}:${tileSig}`;
}
