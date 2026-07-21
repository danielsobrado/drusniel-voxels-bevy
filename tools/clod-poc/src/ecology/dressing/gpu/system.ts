import type * as THREE from "three";
import type { VegetationGpuBackend } from "../../../runtime/vegetation/vegetation_gpu_backend.js";
import { packHydrologyData } from "../../../systems/hydrology_packing.js";
import type { HydrologySystem } from "../../../water/index.js";
import { getDigEditRevision } from "../../../terrain/terrain.js";
import type { DressingConfig, DressingQuality } from "../config.js";
import { cloneDressingDiagnostics, createDressingDiagnostics, type DressingDiagnostics } from "../diagnostics.js";
import {
  DRESSING_GPU_DEFAULT_CAPACITY_PER_GROUP,
} from "./layouts.js";
import { DressingGpuCompute, dressingGpuComputeUnsupportedReason } from "./compute.js";
import { createDressingGpuDrawResources, type DressingGpuDrawResources } from "./render_resources.js";

const DRESSING_GPU_IDLE_REFRESH_FRAMES = 30;

export interface GpuDressingSystemOptions {
  readonly scene: THREE.Scene;
  readonly worldCells: number;
  readonly worldSeed: number;
  readonly config: DressingConfig;
  readonly quality: DressingQuality;
  readonly hydrologySystem?: HydrologySystem | null;
  readonly gpuDevice: GPUDevice;
  readonly gpuBackend: VegetationGpuBackend;
  readonly unboundedWorld?: boolean;
}

export interface DressingSystemLike {
  update(center: { readonly x: number; readonly z: number }): void;
  getStats(): DressingDiagnostics;
  readonly enabled: boolean;
  dispose(): void;
}

export class GpuDressingSystem implements DressingSystemLike {
  private readonly diagnostics: DressingDiagnostics;
  private readonly resources: DressingGpuDrawResources;
  private compute: DressingGpuCompute | null = null;
  private disposed = false;
  private lastCenterX = Number.POSITIVE_INFINITY;
  private lastCenterZ = Number.POSITIVE_INFINITY;
  private pendingCenter: { x: number; z: number } | null = null;
  private frame = 0;
  private lastDispatchFrame = Number.NEGATIVE_INFINITY;
  private lastDigEditRevision = getDigEditRevision();

  constructor(
    private readonly options: GpuDressingSystemOptions,
    onInitializationFailure: (error: unknown) => void,
  ) {
    const unsupported = dressingGpuComputeUnsupportedReason(options.gpuDevice);
    if (unsupported) throw new Error(unsupported);
    this.diagnostics = createDressingDiagnostics(options.config.enabled);
    this.resources = createDressingGpuDrawResources(
      options.scene,
      options.gpuBackend,
      DRESSING_GPU_DEFAULT_CAPACITY_PER_GROUP,
      options.worldCells,
    );
    this.resources.root.visible = options.config.enabled;
    this.diagnostics.dressing_clusters_active = options.config.enabled ? 1 : 0;
    this.publishDiagnostics();
    void DressingGpuCompute.create(
      options.gpuDevice,
      this.resources.outputBuffers,
      options.config,
      options.quality,
      this.resources.indexCounts,
      DRESSING_GPU_DEFAULT_CAPACITY_PER_GROUP,
      options.worldSeed,
      options.hydrologySystem ? packHydrologyData(options.hydrologySystem) : null,
    ).then((compute) => {
      if (this.disposed) {
        compute.destroy();
        return;
      }
      this.compute = compute;
      const center = this.pendingCenter;
      if (center) this.dispatch(center.x, center.z);
    }).catch((error) => {
      if (this.disposed) return;
      onInitializationFailure(error);
    });
  }

  update(center: { readonly x: number; readonly z: number }): void {
    if (!this.options.config.enabled || this.disposed) return;
    const frame = this.frame++;
    const refreshDistance = this.options.config.clusterSizeM * 0.5;
    const moved = Math.hypot(center.x - this.lastCenterX, center.z - this.lastCenterZ) >= refreshDistance;
    const digRevision = getDigEditRevision();
    const editsChanged = digRevision !== this.lastDigEditRevision;
    const periodicRefresh = frame - this.lastDispatchFrame >= DRESSING_GPU_IDLE_REFRESH_FRAMES;
    if (!moved && !editsChanged && !periodicRefresh) return;
    this.lastDigEditRevision = digRevision;
    this.pendingCenter = { x: center.x, z: center.z };
    if (this.compute) this.dispatch(center.x, center.z);
  }

  getStats(): DressingDiagnostics {
    return cloneDressingDiagnostics(this.diagnostics);
  }

  get enabled(): boolean {
    return this.options.config.enabled;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.compute?.destroy();
    this.compute = null;
    this.resources.dispose();
  }

  private dispatch(centerX: number, centerZ: number): void {
    const compute = this.compute;
    if (!compute) return;
    const started = performance.now();
    compute.dispatch({
      centerX,
      centerZ,
      worldCells: this.options.worldCells,
      unboundedWorld: this.options.unboundedWorld === true,
    });
    const stats = compute.stats();
    this.lastCenterX = centerX;
    this.lastCenterZ = centerZ;
    this.pendingCenter = null;
    this.lastDispatchFrame = this.frame;
    this.diagnostics.dressing_candidates_generated = stats.candidateCount;
    this.diagnostics.dressing_gpu_ms = stats.submitMs;
    this.diagnostics.dressing_main_thread_ms = performance.now() - started;
    this.diagnostics.dressing_clusters_active = 1;
    this.publishDiagnostics();
  }

  private publishDiagnostics(): void {
    const counters = (globalThis as typeof globalThis & {
      window?: { __drusnielClod?: { stats?: { counters?: Record<string, number> } } };
    }).window?.__drusnielClod?.stats?.counters;
    if (!counters) return;
    for (const [name, value] of Object.entries(this.diagnostics)) {
      if (name !== "perClass" && typeof value === "number") counters[name] = value;
    }
    const stats = this.compute?.stats();
    counters["dressing_gpu_authority"] = 1;
    counters["dressing_cpu_candidate_generation"] = 0;
    counters["dressing_gpu_readbacks"] = 0;
    counters["dressing_environment_query_gpu_mirror"] = stats?.canonicalHeightAuthorityActive ? 1 : 0;
    counters["dressing_canopy_authority_active"] = stats?.canopyAuthorityActive ? 1 : 0;
    counters["dressing_persistent_exclusion_count"] = stats?.persistentExclusionCount ?? 0;
    counters["dressing_persistent_exclusion_revision"] = stats?.persistentExclusionRevision ?? 0;
    counters["dressing_persistent_exclusion_gpu_authority"] = stats ? 1 : 0;
  }
}
