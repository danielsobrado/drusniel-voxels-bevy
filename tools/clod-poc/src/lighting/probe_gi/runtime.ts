import {
  PROBE_GI_TOTAL_PROBES,
} from "./constants.js";
import {
  createProbeGiCascadeState,
  markProbeGiColumnPositioned,
} from "./cascade_layout.js";
import {
  probeGiOriginEqual,
  probeGiOriginForCamera,
} from "./clipmap_origin.js";
import {
  createProbeGiDiagnostics,
  publishProbeGiDiagnostics,
  setProbeGiCascadeRecenteredColumns,
  type ProbeGiDiagnostics,
} from "./diagnostics.js";
import { createProbeGiGpuResources, type ProbeGiGpuResources } from "./gpu/resources.js";
import { positionProbeGiColumn, createProbeGiPositioningStats } from "./probe_positioning.js";
import {
  probeGiPendingColumnCount,
  rebuildProbeGiPositioningQueue,
  takeNextProbeGiPendingColumn,
  type ProbeGiPendingColumn,
} from "./positioning_queue.js";
import { ProbeGiPublication } from "./publication.js";
import type {
  ProbeGiCascadeState,
  ProbeGiConfig,
  ProbeGiProviders,
} from "./types.js";

export interface ProbeGiRuntimeOptions {
  readonly device?: GPUDevice | null;
  readonly clock?: () => number;
  readonly positioningBudgetMs?: number;
  readonly maximumColumnsPerFrame?: number;
}

export interface ProbeGiRuntime {
  readonly config: ProbeGiConfig;
  readonly cascades: readonly ProbeGiCascadeState[];
  readonly publication: ProbeGiPublication;
  readonly gpuResources: ProbeGiGpuResources | null;
  readonly diagnostics: ProbeGiDiagnostics;
  update(cameraX: number, cameraZ: number, frame: number): boolean;
  publishFrameBoundary(frame: number): boolean;
  dispose(): void;
}

let activeRuntime: ProbeGiRuntime | null = null;

export function createProbeGiRuntime(
  config: ProbeGiConfig,
  providers: ProbeGiProviders,
  cameraX: number,
  cameraZ: number,
  options: ProbeGiRuntimeOptions = {},
): ProbeGiRuntime {
  const clock = options.clock ?? (() => performance.now());
  const positioningBudgetMs = options.positioningBudgetMs ?? config.positioning.maxMsPerFrame;
  const maximumColumnsPerFrame = options.maximumColumnsPerFrame ?? config.positioning.maxColumnsPerFrame;
  const publication = new ProbeGiPublication(config.cascades);
  const cascades = config.cascades.map((cascade) => {
    const origin = probeGiOriginForCamera(cameraX, cameraZ, cascade);
    return createProbeGiCascadeState(cascade, origin);
  });
  const gpuResources = createProbeGiGpuResources(options.device, cascades);
  const queues = cascades.map((cascade) => rebuildProbeGiPositioningQueue(cascade, 0));
  const cpuStorageBytes = cascades.reduce((total, cascade) => total + cascade.records.byteLength, 0);
  // Data3DTexture retains CPU backing arrays and creates matching GPU textures.
  const textureBytes = publication.byteSize() * 2;
  const diagnostics = createProbeGiDiagnostics(
    config.enabled,
    PROBE_GI_TOTAL_PROBES,
    cpuStorageBytes,
    gpuResources?.byteSize ?? 0,
    textureBytes,
  );
  diagnostics.probe_gi_new_slab_queue = probeGiPendingColumnCount(queues);
  publication.queueEmptyPublish(0);

  const runtime: ProbeGiRuntime = {
    config,
    cascades,
    publication,
    gpuResources,
    diagnostics,
    update(nextCameraX, nextCameraZ, frame) {
      diagnostics.probe_gi_positioned_this_frame = 0;
      diagnostics.probe_gi_position_ms = 0;
      for (const cascade of cascades) setProbeGiCascadeRecenteredColumns(diagnostics, cascade.config.id, 0);
      if (!config.enabled || config.debug.freezeUpdates) {
        publishProbeGiDiagnostics(diagnostics);
        return false;
      }

      let recentered = false;
      for (let cascadeIndex = 0; cascadeIndex < cascades.length; cascadeIndex++) {
        const cascade = cascades[cascadeIndex];
        const nextOrigin = probeGiOriginForCamera(nextCameraX, nextCameraZ, cascade.config);
        if (probeGiOriginEqual(cascade.origin, nextOrigin)) continue;
        cascade.origin = nextOrigin;
        queues[cascadeIndex] = rebuildProbeGiPositioningQueue(cascade, frame);
        setProbeGiCascadeRecenteredColumns(diagnostics, cascade.config.id, queues[cascadeIndex].length);
        recentered = true;
      }

      const pendingBefore = probeGiPendingColumnCount(queues);
      diagnostics.probe_gi_new_slab_queue = pendingBefore;
      if (pendingBefore === 0) {
        publishProbeGiDiagnostics(diagnostics);
        return recentered;
      }

      const start = clock();
      const terrainRevision = providers.terrain.revision();
      let processedColumns = 0;
      while (processedColumns < maximumColumnsPerFrame) {
        if (processedColumns > 0 && clock() - start >= positioningBudgetMs) break;
        const item = takeNextProbeGiPendingColumn(queues, frame);
        if (!item) break;
        const stats = createProbeGiPositioningStats();
        const positioned = positionProbeGiColumn(
          item.cascade,
          item.worldCellX,
          item.worldCellZ,
          providers,
          config,
          terrainRevision,
          frame,
          stats,
        );
        applyPositioningStats(diagnostics, stats);
        gpuResources?.uploadColumn(item.cascade, item.worldCellX, item.worldCellZ);
        if (positioned) {
          markProbeGiColumnPositioned(item.cascade, item.worldCellX, item.worldCellZ);
        } else {
          queueForCascade(queues, item.cascade).push({
            ...item,
            readyFrame: frame + config.positioning.unknownRetryFrames,
          });
        }
        processedColumns++;
      }

      diagnostics.probe_gi_positioned_this_frame = processedColumns;
      diagnostics.probe_gi_position_ms = clock() - start;
      diagnostics.probe_gi_new_slab_queue = probeGiPendingColumnCount(queues);
      diagnostics.probe_gi_invalid_probes = diagnostics.probe_gi_total_probes - diagnostics.probe_gi_valid_probes;
      publishProbeGiDiagnostics(diagnostics);
      return recentered || processedColumns > 0;
    },
    publishFrameBoundary(frame) {
      const published = publication.publishAtFrameBoundary(frame);
      if (published) {
        diagnostics.probe_gi_publish_generation++;
        publishProbeGiDiagnostics(diagnostics);
      }
      return published;
    },
    dispose() {
      gpuResources?.dispose();
      publication.dispose();
      if (activeRuntime === runtime) activeRuntime = null;
    },
  };

  activeRuntime = runtime;
  publishProbeGiDiagnostics(diagnostics);
  return runtime;
}

export function readActiveProbeGiRuntime(): ProbeGiRuntime | null {
  return activeRuntime;
}

function queueForCascade(
  queues: readonly ProbeGiPendingColumn[][],
  cascade: ProbeGiCascadeState,
): ProbeGiPendingColumn[] {
  const index = cascade.config.id === "near" ? 0 : cascade.config.id === "mid" ? 1 : 2;
  return queues[index];
}

function applyPositioningStats(
  diagnostics: ProbeGiDiagnostics,
  stats: ReturnType<typeof createProbeGiPositioningStats>,
): void {
  diagnostics.probe_gi_valid_probes += stats.validDelta;
  diagnostics.probe_gi_relocated_count += stats.relocatedDelta;
  diagnostics.probe_gi_terrain_unknown_count += stats.terrainUnknownDelta;
}
