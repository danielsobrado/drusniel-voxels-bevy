import type GUI from "lil-gui";
import type { NaadfIntegration } from "../../naadf/integration.js";
import type { NaadfTraversalMode } from "../../naadf/config.js";
import { NAADF_GPU_ATLAS_WINDOW_TILE_OPTIONS, isValidNaadfGpuAtlasWindowTiles } from "../../naadf/config.js";
import type { GuiController } from "./gui_controller.js";

const RELOAD_BACKED_PARAMS = new Set(["naadfAtlasWindow", "naadfGpuAtlasWindow"]);
const FLOAT_RGBA_BYTES = 16;
const GPU_ATLAS_TEXTURE_COUNT = 4;
const BYTES_PER_MIB = 1024 * 1024;

export interface NaadfGuiDeps {
  getIntegration: () => NaadfIntegration | null | undefined;
}

export function createNaadfGui(gui: GUI, deps: NaadfGuiDeps): GuiController | null {
  const integration = deps.getIntegration();
  if (!integration) return null;

  const folder = gui.addFolder("NAADF PoC");
  const debug = integration.config.debug;
  const traversal = integration.config.traversal;
  const farShell = integration.config.farShell;
  const toggles = {
    enabled: integration.config.enabled,
    traversalMode: traversal.mode,
    hddaUseDirectionalBounds: traversal.hddaUseDirectionalBounds,
    gpuAtlasWindowTiles: farShell.gpuAtlasWindowTiles,
    freezeStreamCenter: debug.freezeStreamCenter,
    showStreamCenter: debug.showStreamCenter,
    showPredictedStreamCenter: debug.showPredictedStreamCenter,
    showNearPageTable: debug.showNearPageTable,
    showHashFallbackTiles: debug.showHashFallbackTiles,
    showFarClipmapRings: debug.showFarClipmapRings,
    showMissingSamples: debug.showMissingSamples,
    showPrimaryDebugRays: debug.showRaySteps,
    showSunVisibility: debug.showSunVisibility,
    showAadfSkips: debug.showAadfSkips,
    showSummaryMips: debug.showSummaryMips,
    showStaleSummaries: debug.showStaleSummaries,
    showEviction: debug.showEviction,
  };

  folder.add(toggles, "traversalMode", ["dense", "hdda", "compare"]).name("traversal mode").onChange((v: NaadfTraversalMode) => {
    traversal.mode = v;
  });
  folder.add(toggles, "hddaUseDirectionalBounds").name("HDDA directional bounds").onChange((v: boolean) => {
    traversal.hddaUseDirectionalBounds = v;
  });
  folder.add(toggles, "gpuAtlasWindowTiles", [...NAADF_GPU_ATLAS_WINDOW_TILE_OPTIONS]).name("GPU atlas window").onChange((v: number | string) => {
    const next = Number(v);
    if (!isValidNaadfGpuAtlasWindowTiles(next) || next === farShell.gpuAtlasWindowTiles) return;
    reloadWithQueryParam("naadfAtlasWindow", String(next));
  });
  folder.add(toggles, "freezeStreamCenter").name("freeze stream center").onChange((v: boolean) => {
    debug.freezeStreamCenter = v;
  });
  folder.add(toggles, "showStreamCenter").name("show stream center").onChange((v: boolean) => {
    debug.showStreamCenter = v;
  });
  folder.add(toggles, "showPredictedStreamCenter").name("show predicted center").onChange((v: boolean) => {
    debug.showPredictedStreamCenter = v;
  });
  folder.add(toggles, "showNearPageTable").name("show near page table").onChange((v: boolean) => {
    debug.showNearPageTable = v;
  });
  folder.add(toggles, "showHashFallbackTiles").name("show hash fallback").onChange((v: boolean) => {
    debug.showHashFallbackTiles = v;
  });
  folder.add(toggles, "showFarClipmapRings").name("show far clipmap rings").onChange((v: boolean) => {
    debug.showFarClipmapRings = v;
  });
  folder.add(toggles, "showMissingSamples").name("show missing samples").onChange((v: boolean) => {
    debug.showMissingSamples = v;
  });
  folder.add(toggles, "showPrimaryDebugRays").name("show primary debug rays").onChange((v: boolean) => {
    debug.showRaySteps = v;
  });
  folder.add(toggles, "showSunVisibility").name("show sun visibility").onChange((v: boolean) => {
    debug.showSunVisibility = v;
  });
  folder.add(toggles, "showAadfSkips").name("show AADF skips").onChange((v: boolean) => {
    debug.showAadfSkips = v;
  });
  folder.add(toggles, "showSummaryMips").name("show mip level sampled").onChange((v: boolean) => {
    debug.showSummaryMips = v;
  });
  folder.add(toggles, "showStaleSummaries").name("show stale summaries").onChange((v: boolean) => {
    debug.showStaleSummaries = v;
  });
  folder.add(toggles, "showEviction").name("show eviction").onChange((v: boolean) => {
    debug.showEviction = v;
  });

  const stats = {
    residentChunks: 0,
    residentFarTiles: 0,
    requestedJobs: 0,
    buildingJobs: 0,
    committedJobs: 0,
    evictedChunks: 0,
    nearTableHits: 0,
    hashFallbackHits: 0,
    farClipmapHits: 0,
    missingSamples: 0,
    unknownSunSamples: 0,
    primaryP50: 0,
    primaryP95: 0,
    sunP50: 0,
    sunP95: 0,
    aadfSkips: 0,
    hddaRays: 0,
    hddaSpanSteps: 0,
    hddaChunkSkips: 0,
    hddaBlockSkips: 0,
    hddaVoxelSteps: 0,
    hddaDenseMismatches: 0,
    hddaFallbackToDense: 0,
    farShellSamples: 0,
    farShellMissing: 0,
    canopySamples: 0,
    shadowProxySamples: 0,
    atlasWindowTiles: 0,
    atlasCells: 0,
    atlasPixels: 0,
    atlasTextures: 0,
    atlasRevision: 0,
    atlasMiB: 0,
  };

  const statsFolder = folder.addFolder("stats");
  statsFolder.add(stats, "residentChunks").name("resident chunks").listen();
  statsFolder.add(stats, "residentFarTiles").name("resident far tiles").listen();
  statsFolder.add(stats, "requestedJobs").name("requested jobs").listen();
  statsFolder.add(stats, "buildingJobs").name("building jobs").listen();
  statsFolder.add(stats, "committedJobs").name("committed jobs/frame").listen();
  statsFolder.add(stats, "evictedChunks").name("evicted chunks/frame").listen();
  statsFolder.add(stats, "nearTableHits").name("near table hits").listen();
  statsFolder.add(stats, "hashFallbackHits").name("hash fallback hits").listen();
  statsFolder.add(stats, "farClipmapHits").name("far clipmap hits").listen();
  statsFolder.add(stats, "missingSamples").name("missing samples").listen();
  statsFolder.add(stats, "unknownSunSamples").name("unknown sun samples").listen();
  statsFolder.add(stats, "primaryP50").name("primary ray p50 steps").listen();
  statsFolder.add(stats, "primaryP95").name("primary ray p95 steps").listen();
  statsFolder.add(stats, "sunP50").name("sun ray p50 steps").listen();
  statsFolder.add(stats, "sunP95").name("sun ray p95 steps").listen();
  statsFolder.add(stats, "aadfSkips").name("AADF skips/frame").listen();
  statsFolder.add(stats, "hddaRays").name("HDDA rays/frame").listen();
  statsFolder.add(stats, "hddaSpanSteps").name("HDDA span steps/frame").listen();
  statsFolder.add(stats, "hddaChunkSkips").name("HDDA chunk skips/frame").listen();
  statsFolder.add(stats, "hddaBlockSkips").name("HDDA block skips/frame").listen();
  statsFolder.add(stats, "hddaVoxelSteps").name("HDDA voxel steps/frame").listen();
  statsFolder.add(stats, "hddaDenseMismatches").name("HDDA compare mismatches").listen();
  statsFolder.add(stats, "hddaFallbackToDense").name("HDDA dense fallbacks").listen();
  statsFolder.add(stats, "farShellSamples").name("far shell samples/frame").listen();
  statsFolder.add(stats, "farShellMissing").name("far shell missing/frame").listen();
  statsFolder.add(stats, "canopySamples").name("canopy samples/frame").listen();
  statsFolder.add(stats, "shadowProxySamples").name("shadow proxy samples/frame").listen();
  statsFolder.add(stats, "atlasWindowTiles").name("atlas window tiles").listen();
  statsFolder.add(stats, "atlasCells").name("atlas cells/ring").listen();
  statsFolder.add(stats, "atlasPixels").name("atlas total pixels").listen();
  statsFolder.add(stats, "atlasTextures").name("atlas textures").listen();
  statsFolder.add(stats, "atlasRevision").name("atlas upload revision").listen();
  statsFolder.add(stats, "atlasMiB").name("atlas MiB estimate").listen();

  return {
    updateDisplay: () => {
      const snap = integration.getMetricsSnapshot();
      stats.residentChunks = snap.residentChunks;
      stats.residentFarTiles = snap.residentFarTiles;
      stats.requestedJobs = snap.queuedJobs;
      stats.buildingJobs = snap.buildingJobs;
      stats.committedJobs = snap.committedJobs;
      stats.evictedChunks = snap.evictedEntries;
      stats.nearTableHits = snap.nearTableHits;
      stats.hashFallbackHits = snap.hashFallbackHits;
      stats.farClipmapHits = snap.farClipmapHits;
      stats.missingSamples = snap.missingSamples;
      stats.unknownSunSamples = snap.unknownSunSamples;
      stats.primaryP50 = snap.primaryStepsP50;
      stats.primaryP95 = snap.primaryStepsP95;
      stats.sunP50 = snap.sunStepsP50;
      stats.sunP95 = snap.sunStepsP95;
      stats.aadfSkips = snap.aadfSkips;
      stats.hddaRays = snap.hddaRays;
      stats.hddaSpanSteps = snap.hddaSpanSteps;
      stats.hddaChunkSkips = snap.hddaChunkSkips;
      stats.hddaBlockSkips = snap.hddaBlockSkips;
      stats.hddaVoxelSteps = snap.hddaVoxelSteps;
      stats.hddaDenseMismatches = snap.hddaDenseMismatches;
      stats.hddaFallbackToDense = snap.hddaFallbackToDense;
      stats.farShellSamples = snap.farShellSamples;
      stats.farShellMissing = snap.farShellMissingSamples;
      stats.canopySamples = snap.canopySamples;
      stats.shadowProxySamples = snap.shadowProxySamples;

      const atlas = integration.getFarSummaryGpuAtlasView();
      stats.atlasWindowTiles = integration.config.farShell.gpuAtlasWindowTiles;
      stats.atlasCells = atlas?.rings[0]
        ? atlas.rings[0].widthCells * atlas.rings[0].heightCells
        : 0;
      stats.atlasPixels = atlas ? atlas.widthCells * atlas.heightCells : 0;
      stats.atlasTextures = atlas ? GPU_ATLAS_TEXTURE_COUNT : 0;
      stats.atlasRevision = atlas?.revision ?? 0;
      stats.atlasMiB = atlas
        ? Number(((atlas.widthCells * atlas.heightCells * FLOAT_RGBA_BYTES * GPU_ATLAS_TEXTURE_COUNT) / BYTES_PER_MIB).toFixed(3))
        : 0;
    },
  };
}

function reloadWithQueryParam(key: string, value: string): void {
  const next = new URLSearchParams(location.search);
  for (const reloadBackedKey of RELOAD_BACKED_PARAMS) {
    next.delete(reloadBackedKey);
  }
  next.set(key, value);
  location.assign(`${location.pathname}?${next.toString()}${location.hash}`);
}
