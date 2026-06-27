import * as THREE from "three";
import type { HeightNormalMaterial, FarSummarySamplerOptions } from "./farSummarySampler.js";
import { sampleBlendedHeightNormalMaterial } from "./farSummarySampler.js";
import { createInfiniteFarShellMaterial, updateFarShellMaterialMaterial, type InfiniteFarShellMaterialOptions } from "./infiniteFarShellMaterial.js";
import type { FarShellMetrics } from "./farShellMetrics.js";
import type { FarHeightProvider } from "../far-summary/clipmap-sampler.js";
import {
  createFarTerrainMaterial,
  computeFarTerrainVertexColors,
  createVertexColorBuffer,
  updateFarTerrainMaterialCenter,
  updateFarTerrainMaterialSummaryAtlas,
} from "../farTerrain/farTerrainMaterial.js";
import type { FarTerrainUniformData } from "../farTerrain/farTerrainUniforms.js";
import type { FarSummaryGpuAtlasView } from "../naadf/gpu/farSummaryAtlas.js";

export type FarShellHeightSamplingMode = "cpu" | "gpu";

export interface InfiniteFarShellOptions {
  innerMeters: number;
  outerMeters: number;
  radialSegments: number;
  angularSegments: number;
  heightBiasMeters: number;
  nearBlendMeters: number;
  farFadeMeters: number;
  macroBlendStartMeters: number;
  macroBlendEndMeters: number;
  rebaseSnapMeters: number;
  lighting: {
    sunDirection: THREE.Vector3;
    sunColor: THREE.Color;
    skyLight: THREE.Color;
    groundLight: THREE.Color;
  };
  useParityMaterial?: boolean;
  parityConfig?: FarTerrainUniformData;
  heightSamplingMode?: FarShellHeightSamplingMode;
  farSummaryGpuAtlas?: FarSummaryGpuAtlasView;
  debugShowMissingFallback?: boolean;
  debugShowWireframe?: boolean;
  metrics?: FarShellMetrics;
}

export interface SnappedCenter {
  worldX: number;
  worldZ: number;
  snappedX: number;
  snappedZ: number;
}

function resolveHeightSamplingMode(options: InfiniteFarShellOptions): FarShellHeightSamplingMode {
  const requested = options.heightSamplingMode ?? "cpu";
  return requested === "gpu" && options.useParityMaterial && options.parityConfig ? "gpu" : "cpu";
}

export class InfiniteFarShell {
  readonly mesh: THREE.Mesh;
  private readonly options: InfiniteFarShellOptions;
  private readonly samplerOptions: FarSummarySamplerOptions;
  private readonly metrics: FarShellMetrics;
  private readonly heightSamplingMode: FarShellHeightSamplingMode;
  private readonly farSummaryGpuAtlas: FarSummaryGpuAtlasView | undefined;
  private heightProvider: FarHeightProvider | undefined;
  private receiveSunShadows = false;
  private snappedX = 0;
  private snappedZ = 0;
  private rebuildCount = 0;
  private lastRebuildMs = 0;
  private materialOptions: InfiniteFarShellMaterialOptions;
  private readonly useParityMaterial: boolean;
  private readonly parityConfig: FarTerrainUniformData | undefined;
  private parityColorBuffer: Float32Array | null = null;
  private positions: Float32Array;
  private normals: Float32Array;
  private uvs: Float32Array;
  private indices: number[];

  constructor(options: InfiniteFarShellOptions) {
    this.options = options;
    this.heightSamplingMode = resolveHeightSamplingMode(options);
    this.farSummaryGpuAtlas = options.farSummaryGpuAtlas;
    this.metrics = options.metrics ?? {
      farShellEnabled: true,
      farShellInnerM: options.innerMeters,
      farShellOuterM: options.outerMeters,
      farShellVertices: 0,
      farShellTriangles: 0,
      farShellGridRes: 0,
      farShellRebuilds: 0,
      farShellLastRebuildMs: 0,
      farShellCenterX: 0,
      farShellCenterZ: 0,
      farShellSnappedX: 0,
      farShellSnappedZ: 0,
      farSummaryTilesRequired: 0,
      farSummaryTilesReady: 0,
      farSummaryTilesMissing: 0,
      farSummaryTilesStale: 0,
      farSummaryTilesBuiltThisFrame: 0,
      farSummaryCacheSize: 0,
      farSummaryFallbackSamples: 0,
    };
    this.useParityMaterial = options.useParityMaterial ?? false;
    this.parityConfig = options.parityConfig;
    this.samplerOptions = {
      macroBlendStartMeters: options.macroBlendStartMeters,
      macroBlendEndMeters: options.macroBlendEndMeters,
      metrics: this.metrics,
    };
    this.materialOptions = {
      lighting: options.lighting,
      innerMeters: options.innerMeters,
      outerMeters: options.outerMeters,
      nearBlendMeters: options.nearBlendMeters,
      farFadeMeters: options.farFadeMeters,
      debugShowMissingFallback: options.debugShowMissingFallback ?? false,
    };
    const useParity = this.useParityMaterial && this.parityConfig;
    const material = useParity
      ? createFarTerrainMaterial(options.lighting, this.parityConfig!, 0, 0, options.outerMeters, {
          gpuDisplacement: this.heightSamplingMode === "gpu",
          heightBiasMeters: options.heightBiasMeters,
          summaryAtlas: this.heightSamplingMode === "gpu" ? this.farSummaryGpuAtlas : undefined,
        })
      : createInfiniteFarShellMaterial(this.materialOptions);
    if (options.debugShowWireframe && "wireframe" in material) {
      (material as unknown as { wireframe: boolean }).wireframe = true;
    }
    const vertexCount = this.computeVertexCount();
    this.positions = new Float32Array(vertexCount * 3);
    this.normals = new Float32Array(vertexCount * 3);
    this.uvs = new Float32Array(vertexCount * 2);
    this.indices = [];
    this.buildAnnularGeometry(this.positions, this.normals, this.uvs, this.indices);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(this.normals, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(this.uvs, 2));
    geometry.setIndex(this.indices);
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;
    if (useParity) this.attachGpuDefaultVertexColors(vertexCount);
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

  private buildAnnularGeometry(positions: Float32Array, normals: Float32Array, uvs: Float32Array, indices: number[]): void {
    const { innerMeters, outerMeters, angularSegments, radialSegments } = this.options;
    let vi = 0;
    for (let ri = 0; ri <= radialSegments; ri++) {
      const r = innerMeters + (outerMeters - innerMeters) * (ri / radialSegments);
      for (let ai = 0; ai <= angularSegments; ai++) {
        const theta = (ai / angularSegments) * Math.PI * 2;
        positions[vi * 3] = r * Math.cos(theta);
        positions[vi * 3 + 1] = 0;
        positions[vi * 3 + 2] = r * Math.sin(theta);
        normals[vi * 3] = 0;
        normals[vi * 3 + 1] = 1;
        normals[vi * 3 + 2] = 0;
        uvs[vi * 2] = ri / radialSegments;
        uvs[vi * 2 + 1] = ai / angularSegments;
        vi++;
      }
    }
    for (let ri = 0; ri < radialSegments; ri++) {
      for (let ai = 0; ai < angularSegments; ai++) {
        const a = ri * (angularSegments + 1) + ai;
        const b = a + 1;
        const c = a + (angularSegments + 1);
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
  }

  setHeightProvider(provider: FarHeightProvider | undefined): void {
    this.heightProvider = provider;
    if (this.heightSamplingMode === "cpu") this.rebuildHeights();
  }

  setDebugShowMissingFallback(on: boolean): void {
    this.materialOptions.debugShowMissingFallback = on;
    if (Array.isArray(this.mesh.material)) return;
    updateFarShellMaterialMaterial(this.mesh.material as import("three/webgpu").MeshBasicNodeMaterial, this.materialOptions);
  }

  setDebugShowWireframe(on: boolean): void {
    (this.mesh.material as unknown as { wireframe: boolean }).wireframe = on;
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
    this.mesh.position.set(this.snappedX, 0, this.snappedZ);
    if (this.useParityMaterial && this.parityConfig) {
      const material = this.mesh.material as import("three/webgpu").MeshBasicNodeMaterial;
      updateFarTerrainMaterialCenter(material, this.snappedX, this.snappedZ);
      if (this.heightSamplingMode === "gpu" && this.farSummaryGpuAtlas) {
        updateFarTerrainMaterialSummaryAtlas(material, this.farSummaryGpuAtlas);
      }
    }
  }

  private rebuildHeights(): void {
    const t0 = performance.now();
    const { angularSegments, radialSegments, heightBiasMeters } = this.options;
    const vertexCount = this.computeVertexCount();
    for (let ri = 0; ri <= radialSegments; ri++) {
      const rNorm = ri / radialSegments;
      const r = this.options.innerMeters + (this.options.outerMeters - this.options.innerMeters) * rNorm;
      for (let ai = 0; ai <= angularSegments; ai++) {
        const theta = (ai / angularSegments) * Math.PI * 2;
        const localX = r * Math.cos(theta);
        const localZ = r * Math.sin(theta);
        const sample: HeightNormalMaterial = sampleBlendedHeightNormalMaterial(
          this.snappedX + localX,
          this.snappedZ + localZ,
          r,
          this.heightProvider,
          this.samplerOptions,
        );
        const vi = ri * (angularSegments + 1) + ai;
        this.positions[vi * 3] = localX;
        this.positions[vi * 3 + 1] = Number.isFinite(sample.height) ? sample.height + heightBiasMeters : 0;
        this.positions[vi * 3 + 2] = localZ;
        this.normals[vi * 3] = sample.normal.x;
        this.normals[vi * 3 + 1] = sample.normal.y;
        this.normals[vi * 3 + 2] = sample.normal.z;
        this.uvs[vi * 2] = rNorm;
        this.uvs[vi * 2 + 1] = ai / angularSegments;
      }
    }

    if (this.useParityMaterial && this.parityConfig) {
      const vertexColors = computeFarTerrainVertexColors(
        this.positions,
        this.normals,
        vertexCount,
        this.parityConfig,
        this.snappedX,
        this.snappedZ,
      );
      this.parityColorBuffer = createVertexColorBuffer(vertexColors, this.parityConfig, this.normals, 0, 0, this.positions);
      this.attachVertexColors();
    }

    this.rebuildCount++;
    this.lastRebuildMs = performance.now() - t0;
    this.metrics.farShellRebuilds = this.rebuildCount;
    this.metrics.farShellLastRebuildMs = this.lastRebuildMs;
    this.flushAttributes();
  }

  private flushAttributes(): void {
    const geometry = this.mesh.geometry as THREE.BufferGeometry;
    const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute;
    const normAttr = geometry.getAttribute("normal") as THREE.BufferAttribute;
    const uvAttr = geometry.getAttribute("uv") as THREE.BufferAttribute;
    posAttr.array.set(this.positions);
    posAttr.needsUpdate = true;
    normAttr.array.set(this.normals);
    normAttr.needsUpdate = true;
    uvAttr.array.set(this.uvs);
    uvAttr.needsUpdate = true;
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
  }

  private attachGpuDefaultVertexColors(vertexCount: number): void {
    const colors = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i++) {
      colors[i * 3] = 0.32;
      colors[i * 3 + 1] = 0.44;
      colors[i * 3 + 2] = 0.28;
    }
    this.parityColorBuffer = colors;
    this.attachVertexColors();
  }

  private attachVertexColors(): void {
    if (!this.parityColorBuffer) return;
    const geometry = this.mesh.geometry as THREE.BufferGeometry;
    const existing = geometry.getAttribute("color");
    if (existing) {
      const buf = existing as THREE.BufferAttribute;
      buf.array.set(this.parityColorBuffer);
      buf.needsUpdate = true;
    } else {
      geometry.setAttribute("color", new THREE.BufferAttribute(this.parityColorBuffer.slice(), 3));
    }
  }

  dispose(): void {
    const geometry = this.mesh.geometry;
    geometry.dispose();
    const mat = this.mesh.material;
    if (Array.isArray(mat)) {
      for (const m of mat) m.dispose();
    } else {
      mat.dispose();
    }
    this.mesh.removeFromParent();
  }
}

export function createInfiniteFarShell(options: InfiniteFarShellOptions): InfiniteFarShell {
  return new InfiniteFarShell(options);
}
