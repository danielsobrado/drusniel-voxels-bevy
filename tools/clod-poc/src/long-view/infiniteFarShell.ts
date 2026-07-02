import * as THREE from "three";
import type { HeightNormalMaterial, FarSummarySamplerOptions } from "./farSummarySampler.js";
import { sampleBlendedHeightNormalMaterial } from "./farSummarySampler.js";
import { createInfiniteFarShellMaterial, updateFarShellMaterialMaterial, type InfiniteFarShellMaterialOptions } from "./infiniteFarShellMaterial.js";
import type { FarShellMetrics } from "./farShellMetrics.js";
import type { FarHeightProvider } from "../far-summary/clipmap-sampler.js";
import { createFarTerrainMaterial, updateFarTerrainMaterialCenter, updateFarTerrainMaterialSummaryAtlas } from "../farTerrain/farTerrainMaterial.js";
import { computeFarTerrainVertexColors, createVertexColorBuffer } from "../farTerrain/far_terrain_vertex_colors.js";
import { createFarWaterMaterial, updateFarWaterMaterialCenter, updateFarWaterMaterialSummaryAtlas } from "../farTerrain/farWaterMaterial.js";
import type { FarTerrainUniformData } from "../farTerrain/farTerrainUniforms.js";
import type { FarSummaryGpuAtlasView } from "../naadf/gpu/farSummaryAtlas.js";
import { writeBiomeRgb } from "../world_source/biome_colors.js";
export type { FarShellHeightSamplingMode, InfiniteFarShellOptions, SnappedCenter } from "./infinite_far_shell_types.js";
import type { FarShellHeightSamplingMode, InfiniteFarShellOptions } from "./infinite_far_shell_types.js";
import { FAR_SHELL_RENDER_ORDER, FAR_SHELL_WATER_RENDER_ORDER, FAR_SHELL_PRIORITY_HEIGHT_OFFSET_M } from "./infinite_far_shell_constants.js";
export { FAR_SHELL_RENDER_ORDER, FAR_SHELL_WATER_RENDER_ORDER, FAR_SHELL_PRIORITY_HEIGHT_OFFSET_M } from "./infinite_far_shell_constants.js";
import {
  resolveHeightSamplingMode, disposeMaterial, applyFarShellDepthBias,
  buildAnnularGeometryData, flushGeometryAttributes,
  attachColorAttribute, createDefaultParityColors, createDefaultBiomeColors,
} from "./infinite_far_shell_helpers.js";

const FAR_SUN_VISIBILITY_SHADE_MIN = 0.62;
const FAR_SUN_VISIBILITY_MISSING_VALUE = 0.5;

type SunLightLookup = { kind: "lit" | "shaded" | "missing" | "pending"; value: number };
type SunLightStats = { active: boolean; entries: number; refreshes: number; tilesBuiltTotal: number };
type SunLightPeekWorld = (x: number, z: number, sunVec: THREE.Vector3) => SunLightLookup;

interface SunLightWindowHooks {
  __drusnielSunLightPeekWorld?: SunLightPeekWorld;
  __drusnielSunLightStats?: () => SunLightStats;
}

function sunLightHooks(): SunLightWindowHooks {
  return typeof window === "undefined"
    ? {}
    : window as unknown as SunLightWindowHooks;
}

function sunVisibilityMultiplier(lookup: SunLightLookup): number {
  if (lookup.kind === "pending") return 1;
  const visibility = lookup.kind === "missing" ? FAR_SUN_VISIBILITY_MISSING_VALUE : lookup.value;
  return FAR_SUN_VISIBILITY_SHADE_MIN + (1 - FAR_SUN_VISIBILITY_SHADE_MIN) * THREE.MathUtils.clamp(visibility, 0, 1);
}

export class InfiniteFarShell {
  readonly mesh: THREE.Mesh;
  private readonly waterMesh: THREE.Mesh | undefined;
  private readonly options: InfiniteFarShellOptions;
  private readonly samplerOptions: FarSummarySamplerOptions;
  private readonly metrics: FarShellMetrics;
  private readonly heightSamplingMode: FarShellHeightSamplingMode;
  private readonly farSummaryGpuAtlas: FarSummaryGpuAtlasView | undefined;
  private heightProvider: FarHeightProvider | undefined;
  private receiveSunShadows = false;
  private snappedX = 0;
  private snappedZ = 0;
  private renderOriginX = 0;
  private renderOriginZ = 0;
  private rebuildCount = 0;
  private lastRebuildMs = 0;
  private materialOptions: InfiniteFarShellMaterialOptions;
  private readonly useParityMaterial: boolean;
  private readonly parityConfig: FarTerrainUniformData | undefined;
  private parityColorBuffer: Float32Array | null = null;
  private biomeColorBuffer: Float32Array | null = null;
  private baseColorBuffer: Float32Array | null = null;
  private sunVisibilityColorSignature = "";
  private positions: Float32Array;
  private normals: Float32Array;
  private uvs: Float32Array;
  private indices: number[];

  constructor(options: InfiniteFarShellOptions) {
    this.options = options;
    this.heightSamplingMode = resolveHeightSamplingMode(options);
    this.farSummaryGpuAtlas = options.farSummaryGpuAtlas;
    this.metrics = options.metrics ?? {
      farShellEnabled: true, farShellInnerM: options.innerMeters, farShellOuterM: options.outerMeters,
      farShellVertices: 0, farShellTriangles: 0, farShellGridRes: 0, farShellRebuilds: 0,
      farShellLastRebuildMs: 0, farShellCenterX: 0, farShellCenterZ: 0,
      farShellSnappedX: 0, farShellSnappedZ: 0, farSummaryTilesRequired: 0,
      farSummaryTilesReady: 0, farSummaryTilesMissing: 0, farSummaryTilesStale: 0,
      farSummaryTilesBuiltThisFrame: 0, farSummaryCacheSize: 0, farSummaryFallbackSamples: 0,
    };
    this.useParityMaterial = options.useParityMaterial ?? false;
    this.parityConfig = options.parityConfig;
    this.samplerOptions = {
      macroBlendStartMeters: options.macroBlendStartMeters,
      macroBlendEndMeters: options.macroBlendEndMeters,
      metrics: this.metrics,
    };
    const useParity = this.useParityMaterial && this.parityConfig !== undefined;
    this.materialOptions = {
      lighting: options.lighting, innerMeters: options.innerMeters, outerMeters: options.outerMeters,
      nearBlendMeters: options.nearBlendMeters, farFadeMeters: options.farFadeMeters,
      debugShowMissingFallback: options.debugShowMissingFallback ?? false, useVertexBiomeColor: !useParity,
    };
    const material = useParity
      ? createFarTerrainMaterial(options.lighting, this.parityConfig!, 0, 0, options.outerMeters, {
          gpuDisplacement: this.heightSamplingMode === "gpu",
          heightBiasMeters: options.heightBiasMeters + FAR_SHELL_PRIORITY_HEIGHT_OFFSET_M,
          summaryAtlas: this.heightSamplingMode === "gpu" ? this.farSummaryGpuAtlas : undefined,
        })
      : createInfiniteFarShellMaterial(this.materialOptions);
    applyFarShellDepthBias(material);
    if (options.debugShowWireframe && "wireframe" in material) {
      (material as unknown as { wireframe: boolean }).wireframe = true;
    }
    const geom = buildAnnularGeometryData(this.options);
    this.positions = geom.positions;
    this.normals = geom.normals;
    this.uvs = geom.uvs;
    this.indices = geom.indices;
    const vertexCount = this.positions.length / 3;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(this.normals, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(this.uvs, 2));
    geometry.setIndex(this.indices);
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = FAR_SHELL_RENDER_ORDER;

    if (this.heightSamplingMode === "gpu" && this.farSummaryGpuAtlas && useParity) {
      const waterMaterial = createFarWaterMaterial(0, 0, this.farSummaryGpuAtlas);
      applyFarShellDepthBias(waterMaterial);
      if (options.debugShowWireframe) (waterMaterial as unknown as { wireframe: boolean }).wireframe = true;
      this.waterMesh = new THREE.Mesh(geometry, waterMaterial);
      this.waterMesh.name = "naadf-far-water-overlay";
      this.waterMesh.castShadow = false;
      this.waterMesh.receiveShadow = false;
      this.waterMesh.frustumCulled = false;
      this.waterMesh.renderOrder = FAR_SHELL_WATER_RENDER_ORDER;
      this.waterMesh.userData["renderOnly"] = true;
      this.waterMesh.userData["collisionEnabled"] = false;
      this.mesh.add(this.waterMesh);
    }

    if (useParity) {
      this.parityColorBuffer = createDefaultParityColors(vertexCount);
      this.captureBaseColors(this.parityColorBuffer);
      this.applySunVisibilityVertexTint(true);
      this.attachVertexColors();
    } else {
      this.biomeColorBuffer = createDefaultBiomeColors(vertexCount);
      this.captureBaseColors(this.biomeColorBuffer);
      this.applySunVisibilityVertexTint(true);
      this.attachBiomeVertexColors();
    }
    this.metrics.farShellVertices = vertexCount;
    this.metrics.farShellTriangles = this.indices.length / 3;
    this.metrics.farShellGridRes = options.radialSegments;
    this.metrics.farShellEnabled = true;
    this.metrics.farShellInnerM = options.innerMeters;
    this.metrics.farShellOuterM = options.outerMeters;
  }

  private computeVertexCount(): number {
    const { angularSegments, radialSegments } = this.options;
    return (angularSegments + 1) * (radialSegments + 1);
  }

  setHeightProvider(provider: FarHeightProvider | undefined): void {
    this.heightProvider = provider;
    if (this.heightSamplingMode === "cpu") this.rebuildHeights();
  }

  setRenderOriginOffset(originX: number, originZ: number): void {
    if (this.renderOriginX === originX && this.renderOriginZ === originZ) return;
    this.renderOriginX = originX;
    this.renderOriginZ = originZ;
    this.applyRenderPosition();
  }

  setDebugShowMissingFallback(on: boolean): void {
    this.materialOptions.debugShowMissingFallback = on;
    if (Array.isArray(this.mesh.material)) return;
    updateFarShellMaterialMaterial(this.mesh.material as import("three/webgpu").MeshBasicNodeMaterial, this.materialOptions);
  }

  setDebugShowWireframe(on: boolean): void {
    (this.mesh.material as unknown as { wireframe: boolean }).wireframe = on;
    if (this.waterMesh && !Array.isArray(this.waterMesh.material)) {
      (this.waterMesh.material as unknown as { wireframe: boolean }).wireframe = on;
    }
  }

  setReceiveSunShadows(on: boolean): void {
    if (this.receiveSunShadows === on) return;
    this.receiveSunShadows = on;
    this.mesh.receiveShadow = on;
  }

  update(cameraWorldX: number, cameraWorldZ: number, _frame: number): void {
    const { rebaseSnapMeters } = this.options;
    const newSnappedX = Math.round(cameraWorldX / rebaseSnapMeters) * rebaseSnapMeters;
    const newSnappedZ = Math.round(cameraWorldZ / rebaseSnapMeters) * rebaseSnapMeters;
    const snappedChanged = newSnappedX !== this.snappedX || newSnappedZ !== this.snappedZ;
    this.snappedX = newSnappedX;
    this.snappedZ = newSnappedZ;
    this.metrics.farShellCenterX = cameraWorldX;
    this.metrics.farShellCenterZ = cameraWorldZ;
    this.metrics.farShellSnappedX = this.snappedX;
    this.metrics.farShellSnappedZ = this.snappedZ;
    if (snappedChanged && this.heightSamplingMode === "cpu") this.rebuildHeights();
    this.applyRenderPosition();
    if (this.useParityMaterial && this.parityConfig) {
      const material = this.mesh.material as import("three/webgpu").MeshBasicNodeMaterial;
      updateFarTerrainMaterialCenter(material, this.snappedX, this.snappedZ);
      if (this.heightSamplingMode === "gpu" && this.farSummaryGpuAtlas) {
        updateFarTerrainMaterialSummaryAtlas(material, this.farSummaryGpuAtlas);
      }
    }
    if (this.waterMesh && this.farSummaryGpuAtlas) {
      const waterMaterial = this.waterMesh.material as import("three/webgpu").MeshBasicNodeMaterial;
      updateFarWaterMaterialCenter(waterMaterial, this.snappedX, this.snappedZ);
      updateFarWaterMaterialSummaryAtlas(waterMaterial, this.farSummaryGpuAtlas);
    }
    this.applySunVisibilityVertexTint(false);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    disposeMaterial(this.mesh.material as THREE.Material | THREE.Material[]);
    if (this.waterMesh) disposeMaterial(this.waterMesh.material as THREE.Material | THREE.Material[]);
  }

  private applyRenderPosition(): void {
    this.mesh.position.set(this.snappedX - this.renderOriginX, 0, this.snappedZ - this.renderOriginZ);
  }

  private rebuildHeights(): void {
    const t0 = performance.now();
    const { angularSegments, radialSegments, heightBiasMeters } = this.options;
    const farShellHeightBiasMeters = heightBiasMeters + FAR_SHELL_PRIORITY_HEIGHT_OFFSET_M;
    const vertexCount = this.computeVertexCount();
    const writeBiomeColors = !(this.useParityMaterial && this.parityConfig);
    if (writeBiomeColors && (!this.biomeColorBuffer || this.biomeColorBuffer.length !== vertexCount * 3)) {
      this.biomeColorBuffer = new Float32Array(vertexCount * 3);
    }
    for (let ri = 0; ri <= radialSegments; ri++) {
      const rNorm = ri / radialSegments;
      const r = this.options.innerMeters + (this.options.outerMeters - this.options.innerMeters) * rNorm;
      for (let ai = 0; ai <= angularSegments; ai++) {
        const theta = (ai / angularSegments) * Math.PI * 2;
        const localX = r * Math.cos(theta);
        const localZ = r * Math.sin(theta);
        const sample: HeightNormalMaterial = sampleBlendedHeightNormalMaterial(this.snappedX + localX, this.snappedZ + localZ, r, this.heightProvider, this.samplerOptions);
        const vi = ri * (angularSegments + 1) + ai;
        this.positions[vi * 3] = localX;
        this.positions[vi * 3 + 1] = Number.isFinite(sample.height) ? sample.height + farShellHeightBiasMeters : 0;
        this.positions[vi * 3 + 2] = localZ;
        this.normals[vi * 3] = sample.normal.x;
        this.normals[vi * 3 + 1] = sample.normal.y;
        this.normals[vi * 3 + 2] = sample.normal.z;
        this.uvs[vi * 2] = rNorm;
        this.uvs[vi * 2 + 1] = ai / angularSegments;
        if (writeBiomeColors && this.biomeColorBuffer) writeBiomeRgb(this.biomeColorBuffer, vi, sample.material);
      }
    }
    if (this.useParityMaterial && this.parityConfig) {
      const vertexColors = computeFarTerrainVertexColors(this.positions, this.normals, vertexCount, this.parityConfig, this.snappedX, this.snappedZ);
      this.parityColorBuffer = createVertexColorBuffer(vertexColors, this.parityConfig, this.normals, 0, 0, this.positions);
      this.captureBaseColors(this.parityColorBuffer);
      this.applySunVisibilityVertexTint(true);
      this.attachVertexColors();
    } else {
      if (this.biomeColorBuffer) this.captureBaseColors(this.biomeColorBuffer);
      this.applySunVisibilityVertexTint(true);
      this.attachBiomeVertexColors();
    }
    this.rebuildCount++;
    this.lastRebuildMs = performance.now() - t0;
    this.metrics.farShellRebuilds = this.rebuildCount;
    this.metrics.farShellLastRebuildMs = this.lastRebuildMs;
    this.flushAttributes();
  }

  private captureBaseColors(buffer: Float32Array | null): void {
    this.baseColorBuffer = buffer ? buffer.slice() : null;
    this.sunVisibilityColorSignature = "";
  }

  private currentColorBuffer(): Float32Array | null {
    return this.useParityMaterial && this.parityConfig ? this.parityColorBuffer : this.biomeColorBuffer;
  }

  private applySunVisibilityVertexTint(force: boolean): void {
    const colorBuffer = this.currentColorBuffer();
    if (!colorBuffer || !this.baseColorBuffer || this.baseColorBuffer.length !== colorBuffer.length) return;
    const hooks = sunLightHooks();
    const stats = hooks.__drusnielSunLightStats?.();
    const peekWorld = hooks.__drusnielSunLightPeekWorld;
    const active = Boolean(stats?.active && peekWorld);
    const signature = active
      ? `on:${stats!.tilesBuiltTotal}:${stats!.refreshes}:${stats!.entries}:${this.snappedX}:${this.snappedZ}`
      : `off:${this.snappedX}:${this.snappedZ}`;
    if (!force && signature === this.sunVisibilityColorSignature) return;
    this.sunVisibilityColorSignature = signature;

    if (!active) {
      colorBuffer.set(this.baseColorBuffer);
      this.markColorAttributeDirty();
      return;
    }

    const vertexCount = colorBuffer.length / 3;
    for (let vi = 0; vi < vertexCount; vi++) {
      const worldX = this.snappedX + this.positions[vi * 3];
      const worldZ = this.snappedZ + this.positions[vi * 3 + 2];
      const multiplier = sunVisibilityMultiplier(peekWorld!(worldX, worldZ, this.options.lighting.sunDirection));
      colorBuffer[vi * 3] = this.baseColorBuffer[vi * 3] * multiplier;
      colorBuffer[vi * 3 + 1] = this.baseColorBuffer[vi * 3 + 1] * multiplier;
      colorBuffer[vi * 3 + 2] = this.baseColorBuffer[vi * 3 + 2] * multiplier;
    }
    this.markColorAttributeDirty();
  }

  private markColorAttributeDirty(): void {
    const attribute = (this.mesh.geometry as THREE.BufferGeometry).getAttribute("color") as THREE.BufferAttribute | undefined;
    if (attribute) attribute.needsUpdate = true;
  }

  private flushAttributes(): void {
    const geometry = this.mesh.geometry as THREE.BufferGeometry;
    flushGeometryAttributes(geometry, this.positions, this.normals, this.uvs);
  }

  private attachVertexColors(): void {
    if (!this.parityColorBuffer) return;
    attachColorAttribute(this.mesh.geometry as THREE.BufferGeometry, this.parityColorBuffer);
  }

  private attachBiomeVertexColors(): void {
    if (!this.biomeColorBuffer) return;
    attachColorAttribute(this.mesh.geometry as THREE.BufferGeometry, this.biomeColorBuffer);
  }
}

export function createInfiniteFarShell(options: InfiniteFarShellOptions): InfiniteFarShell {
  return new InfiniteFarShell(options);
}
