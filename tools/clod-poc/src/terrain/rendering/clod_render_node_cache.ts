import * as THREE from "three";
import type { WebGPURenderer } from "three/webgpu";
import type { EnvironmentLighting } from "../../environment/environment.js";
import type { TerrainColorAdjustments } from "../../material/material.js";
import type { TerrainMaterialHandle } from "../../rendering/terrain_material.js";
import type { TerrainMaterialController, TerrainMaterialUiState } from "../material/terrain_material_controller.js";
import { computeGeometryNormals, toGeometry } from "../geometry/page_geometry.js";
import type { PageGeometryCache, PageGeometryNormalMode } from "../geometry/page_geometry_cache.js";
import type { ClodPageNode } from "../../types.js";
import type { ClodRenderNodeCacheConfig } from "./clod_render_node_cache_config.js";
import {
  applyMaterialIfChanged,
  materialChurnDiagnostics,
} from "../../rendering/material_churn/material_churn_diagnostics.js";
import { getCurrentWebGpuRenderer } from "../../rendering/webgpu_device_bridge.js";
import { acquireGpuClodResidentPage } from "../streaming/gpu_clod_resident_registry.js";
import {
  createExternalGpuClodGeometry,
  isExternalGpuClodGeometry,
  releaseExternalGpuClodGeometry,
} from "../../rendering/webgpu_external_buffer_geometry.js";

export interface ClodRenderNodeCacheStats {
  enabled: boolean;
  materializedNodes: number;
  activeNodes: number;
  inactiveNodes: number;
  creates: number;
  reuses: number;
  disposals: number;
  evictions: number;
  prefetches: number;
  gpuResidentViews: number;
  gpuResidentNormalFallbacks: number;
}

export interface ClodRenderNodeView {
  node: ClodPageNode;
  mesh: THREE.Mesh;
  mat: TerrainMaterialHandle;
  sourceNormals: Float32Array;
  recomputedNormals: Float32Array | null;
  selected: boolean;
  fade: number;
  target: number;
  lastUsedFrame: number;
}

export interface CreateRenderNodeInput {
  node: ClodPageNode;
  frameId: number;
}

export interface ClodRenderNodeCacheDeps {
  scene: THREE.Scene;
  webGpuRenderer?: WebGPURenderer | null;
  materialController: TerrainMaterialController;
  pageGeometryCache: PageGeometryCache;
  getMaterialColorForNode: (node: ClodPageNode) => number;
  getColorAdjustments: () => TerrainColorAdjustments;
  getLighting: () => EnvironmentLighting;
  getMaterialState: () => TerrainMaterialUiState;
  getNormalMode: () => PageGeometryNormalMode;
  config: ClodRenderNodeCacheConfig;
}

interface CacheEntry {
  view: ClodRenderNodeView;
  unsubscribeMaterial: () => void;
}

type RenderNodeDisposeReason = "dispose" | "evict" | "invalidate";

export class ClodRenderNodeCache {
  private readonly deps: ClodRenderNodeCacheDeps;
  private readonly viewMap = new Map<string, ClodRenderNodeView>();
  private readonly entries = new Map<string, CacheEntry>();
  private readonly activeNodeIds = new Set<string>();
  private statCreates = 0;
  private statReuses = 0;
  private statDisposals = 0;
  private statEvictions = 0;
  private statPrefetches = 0;
  private statGpuResidentViews = 0;
  private statGpuResidentNormalFallbacks = 0;
  private lastPruneFrame = -Infinity;
  private warnedAtInactiveNodes = false;

  constructor(deps: ClodRenderNodeCacheDeps) {
    this.deps = deps;
  }

  get size(): number {
    return this.viewMap.size;
  }

  getOrCreate(input: CreateRenderNodeInput): ClodRenderNodeView {
    const existing = this.viewMap.get(input.node.id);
    if (existing) {
      existing.lastUsedFrame = input.frameId;
      this.statReuses++;
      return existing;
    }
    const entry = this.createRenderNodeView(input.node, input.frameId);
    this.entries.set(input.node.id, entry);
    this.viewMap.set(input.node.id, entry.view);
    this.statCreates++;
    return entry.view;
  }

  get(nodeId: string): ClodRenderNodeView | undefined {
    return this.viewMap.get(nodeId);
  }

  has(nodeId: string): boolean {
    return this.viewMap.has(nodeId);
  }

  markActive(nodeIds: ReadonlySet<string>, frameId: number): void {
    this.activeNodeIds.clear();
    for (const nodeId of nodeIds) {
      this.activeNodeIds.add(nodeId);
      const view = this.viewMap.get(nodeId);
      if (view) view.lastUsedFrame = frameId;
    }
  }

  prefetch(nodes: Iterable<ClodPageNode>, frameId: number): void {
    if (!this.deps.config.enabled) return;
    let created = 0;
    for (const node of nodes) {
      if (this.viewMap.has(node.id)) continue;
      this.getOrCreate({ node, frameId });
      this.statPrefetches++;
      created++;
      if (created >= this.deps.config.maxPrefetchCreatesPerFrame) return;
    }
  }

  prune(protectedNodeIds: ReadonlySet<string>, frameId: number): void {
    const config = this.deps.config;
    if (!config.enabled) return;
    if (frameId - this.lastPruneFrame < config.pruneIntervalFrames) return;
    this.lastPruneFrame = frameId;
    const inactive = [...this.viewMap.values()]
      .filter((view) => this.canDisposeView(view, protectedNodeIds))
      .sort((a, b) => a.lastUsedFrame - b.lastUsedFrame);
    if (inactive.length >= config.warnAtInactiveNodes && !this.warnedAtInactiveNodes) {
      this.warnedAtInactiveNodes = true;
      console.warn(`[clod] render node cache has ${inactive.length} inactive nodes`);
    }
    while (inactive.length > config.maxInactiveNodes) {
      const view = inactive.shift();
      if (!view) return;
      this.disposeNodeInternal(view.node.id, "evict");
    }
  }

  invalidateNode(nodeId: string): void {
    this.disposeNodeInternal(nodeId, "invalidate");
  }

  disposeNode(nodeId: string, evicted = false): void {
    this.disposeNodeInternal(nodeId, evicted ? "evict" : "dispose");
  }

  clear(): void {
    for (const nodeId of [...this.viewMap.keys()]) this.disposeNodeInternal(nodeId, "invalidate");
    this.deps.pageGeometryCache.invalidateAll();
    this.activeNodeIds.clear();
    this.warnedAtInactiveNodes = false;
    this.lastPruneFrame = -Infinity;
  }

  dispose(): void {
    for (const nodeId of [...this.viewMap.keys()]) this.disposeNodeInternal(nodeId, "invalidate");
  }

  views(): Map<string, ClodRenderNodeView> {
    return this.viewMap;
  }

  stats(): ClodRenderNodeCacheStats {
    let activeNodes = 0;
    for (const view of this.viewMap.values()) if (this.isActiveView(view)) activeNodes++;
    return {
      enabled: this.deps.config.enabled,
      materializedNodes: this.viewMap.size,
      activeNodes,
      inactiveNodes: Math.max(0, this.viewMap.size - activeNodes),
      creates: this.statCreates,
      reuses: this.statReuses,
      disposals: this.statDisposals,
      evictions: this.statEvictions,
      prefetches: this.statPrefetches,
      gpuResidentViews: this.statGpuResidentViews,
      gpuResidentNormalFallbacks: this.statGpuResidentNormalFallbacks,
    };
  }

  private disposeNodeInternal(nodeId: string, reason: RenderNodeDisposeReason): void {
    const entry = this.entries.get(nodeId);
    if (!entry) return;
    this.entries.delete(nodeId);
    this.viewMap.delete(nodeId);
    this.activeNodeIds.delete(nodeId);
    const { view } = entry;
    this.deps.scene.remove(view.mesh);
    entry.unsubscribeMaterial();
    const geometry = view.mesh.geometry as THREE.BufferGeometry;
    if (isExternalGpuClodGeometry(geometry)) {
      releaseExternalGpuClodGeometry(geometry);
    } else if (this.deps.pageGeometryCache.owns(geometry)) {
      this.deps.pageGeometryCache.setGeometryActive(geometry, false);
      if (reason !== "dispose" && this.deps.config.evictGeometryWithRenderNode) {
        this.deps.pageGeometryCache.invalidateNode(nodeId, { includeActive: true });
      }
    } else {
      geometry.dispose();
    }
    this.releaseMaterial(view.mat);
    this.statDisposals++;
    if (reason === "evict") this.statEvictions++;
  }

  private createRenderNodeView(node: ClodPageNode, frameId: number): CacheEntry {
    const mat = this.deps.materialController.makeTerrainMaterial(this.deps.getMaterialColorForNode(node));
    mat.setColorAdjust(this.deps.getColorAdjustments());
    this.deps.materialController.applyLighting(mat, this.deps.getLighting());
    this.configureCurrentMaterialState(mat);

    const normalMode = this.deps.getNormalMode();
    const webGpuRenderer = node.gpuResidentOnly
      ? this.deps.webGpuRenderer ?? getCurrentWebGpuRenderer()
      : null;
    const residentLease = node.gpuResidentOnly && webGpuRenderer
      ? acquireGpuClodResidentPage(node.id, normalizedRevision(node.revision))
      : null;

    if (node.gpuResidentOnly && (!webGpuRenderer || !residentLease)) {
      this.releaseMaterial(mat);
      throw new Error(
        `[clod] GPU-only page ${node.id} revision ${normalizedRevision(node.revision)} has no resident render buffer`,
      );
    }

    let recomputedNormals: Float32Array | null = null;
    let geometry: THREE.BufferGeometry;
    try {
      if (residentLease && webGpuRenderer) {
        geometry = createExternalGpuClodGeometry(webGpuRenderer, residentLease);
        this.statGpuResidentViews++;
        if (normalMode === "recomputed") this.statGpuResidentNormalFallbacks++;
      } else {
        recomputedNormals = normalMode === "recomputed" ? computeGeometryNormals(node.mesh) : null;
        geometry = this.deps.pageGeometryCache.getOrCreate({
          node,
          normalMode,
          createGeometry: () => {
            const created = toGeometry(node.mesh);
            if (recomputedNormals) {
              created.setAttribute("normal", new THREE.BufferAttribute(recomputedNormals, 3));
            }
            return created;
          },
        });
        this.deps.pageGeometryCache.setGeometryActive(geometry, true);
      }
    } catch (error) {
      residentLease?.release();
      this.releaseMaterial(mat);
      throw error;
    }

    const mesh = new THREE.Mesh(geometry, mat.material);
    mesh.visible = false;
    const unsubscribeMaterial = mat.onMaterialChanged((material) => {
      applyMaterialIfChanged(
        materialChurnDiagnostics,
        node.id,
        mesh,
        material,
        "terrain-material-handle-rebuild",
      );
    });
    this.deps.scene.add(mesh);
    return {
      view: {
        node,
        mesh,
        mat,
        sourceNormals: node.mesh.normals,
        recomputedNormals,
        selected: false,
        fade: 0,
        target: 0,
        lastUsedFrame: frameId,
      },
      unsubscribeMaterial,
    };
  }

  private releaseMaterial(mat: TerrainMaterialHandle): void {
    if (mat === this.deps.materialController.sharedMaterial) return;
    if (!this.deps.materialController.releaseTerrainMaterial(mat)) mat.material.dispose();
  }

  private configureCurrentMaterialState(mat: TerrainMaterialHandle): void {
    const state = this.deps.getMaterialState();
    mat.setWireframe(state.wireframe);
    mat.setDebug({
      normalColor: state.normalColor,
      normalDivergence: state.normalDivergence,
      divergenceGain: state.divergenceGain,
    });
    mat.setTriplanar(state.triplanar);
    mat.setSide(state.frontSideOnly ? THREE.FrontSide : THREE.DoubleSide);
    mat.setTextures(
      this.deps.materialController.activeTerrainSlots(),
      this.deps.materialController.terrainTextureUniformOptions(),
    );
  }

  private canDisposeView(view: ClodRenderNodeView, protectedNodeIds: ReadonlySet<string>): boolean {
    if (protectedNodeIds.has(view.node.id)) return false;
    return !this.isActiveView(view);
  }

  private isActiveView(view: ClodRenderNodeView): boolean {
    return this.activeNodeIds.has(view.node.id)
      || view.selected
      || view.target > 0
      || view.fade > 0.001
      || view.mesh.visible;
  }
}

function normalizedRevision(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value as number)) : 0;
}
