import type { FarSummaryGpuAtlasRingView, FarSummaryGpuAtlasView } from "../naadf/gpu/farSummaryAtlas.js";
import {
  FAR_SUMMARY_RENDER_ATLAS_HALF_FLOAT_BYTES,
  FAR_SUMMARY_RENDER_ATLAS_RGBA_COMPONENTS,
  FAR_SUMMARY_RENDER_ATLAS_TEXTURE_COUNT,
  FAR_SUMMARY_RENDER_ATLAS_TILES_X,
  FAR_SUMMARY_RENDER_ATLAS_TILES_Z,
} from "./gpu-render-atlas-constants.js";
import { createFarSummaryRenderAtlasPipeline, submitFarSummaryRenderAtlasPlan } from "./gpu-render-atlas-pipeline.js";
import { commonFarSummaryRenderAtlasTileCells, planFarSummaryGpuRenderAtlas } from "./gpu-render-atlas-plan.js";
import {
  createFarSummaryRenderAtlasBackTextures,
  createFarSummaryRenderAtlasFrontTextures,
  destroyFarSummaryRenderAtlasTextureSet,
  disposeFarSummaryRenderAtlasFrontTextures,
  initializeFarSummaryRenderAtlasFrontTextures,
} from "./gpu-render-atlas-textures.js";
import type {
  CreateFarSummaryGpuRenderAtlasOptions,
  FarSummaryGpuRenderAtlasPlan,
  FarSummaryGpuRenderAtlasRuntime,
  FarSummaryRenderAtlasTextureSet,
} from "./gpu-render-atlas-types.js";

export { planFarSummaryGpuRenderAtlas } from "./gpu-render-atlas-plan.js";
export { packFarSummaryRenderAtlasDescriptors } from "./gpu-render-atlas-pipeline.js";
export type {
  CreateFarSummaryGpuRenderAtlasOptions,
  FarSummaryGpuRenderAtlasPlan,
  FarSummaryGpuRenderAtlasRuntime,
  FarSummaryGpuRenderAtlasTile,
} from "./gpu-render-atlas-types.js";

let activeAtlasView: FarSummaryGpuAtlasView | undefined;

export function setActiveFarSummaryGpuAtlasView(view: FarSummaryGpuAtlasView | undefined): void {
  activeAtlasView = view;
}

export function getActiveFarSummaryGpuAtlasView(): FarSummaryGpuAtlasView | undefined {
  return activeAtlasView;
}

export function createFarSummaryGpuRenderAtlasRuntime(
  options: CreateFarSummaryGpuRenderAtlasOptions,
): FarSummaryGpuRenderAtlasRuntime | null {
  if (options.config.rings.length === 0) return null;

  let tileCells: number;
  try {
    tileCells = commonFarSummaryRenderAtlasTileCells(options.config.rings);
  } catch (error) {
    console.warn("[far-summary-render-atlas] incompatible ring layout", error);
    return null;
  }

  const width = tileCells * FAR_SUMMARY_RENDER_ATLAS_TILES_X;
  const ringHeight = tileCells * FAR_SUMMARY_RENDER_ATLAS_TILES_Z;
  const height = ringHeight * options.config.rings.length;
  const front = createFarSummaryRenderAtlasFrontTextures(width, height);
  let frontGpu: FarSummaryRenderAtlasTextureSet;
  try {
    frontGpu = initializeFarSummaryRenderAtlasFrontTextures(options.renderer, front);
  } catch (error) {
    disposeFarSummaryRenderAtlasFrontTextures(front);
    console.warn("[far-summary-render-atlas] failed to initialize renderer textures", error);
    return null;
  }

  const back = createFarSummaryRenderAtlasBackTextures(options.device, width, height);
  const view: FarSummaryGpuAtlasView = {
    texture: front.height,
    materialTexture: front.material,
    normalTexture: front.normal,
    coverageTexture: front.coverage,
    rings: options.config.rings.map((ring, ringIndex) => emptyRingView(ring, ringIndex, ringHeight, width)),
    estimatedBytes: width
      * height
      * FAR_SUMMARY_RENDER_ATLAS_RGBA_COMPONENTS
      * FAR_SUMMARY_RENDER_ATLAS_HALF_FLOAT_BYTES
      * FAR_SUMMARY_RENDER_ATLAS_TEXTURE_COUNT,
    debugEstimatedBytes: width
      * height
      * FAR_SUMMARY_RENDER_ATLAS_RGBA_COMPONENTS
      * Float32Array.BYTES_PER_ELEMENT
      * FAR_SUMMARY_RENDER_ATLAS_TEXTURE_COUNT,
    memorySavingsBytes: 0,
    memorySavingsPct: 0,
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
    cellM: options.config.rings[0]!.cellM,
    widthCells: width,
    heightCells: height,
    valid: 0,
    revision: 0,
  };

  const pipelinePromise = createFarSummaryRenderAtlasPipeline(options.device);
  let disposed = false;
  let running = false;
  let submittedSignature = "";
  let pendingPlan: FarSummaryGpuRenderAtlasPlan | null = null;
  let revision = 0;
  let builds = 0;

  publishRenderAtlasCounters(view, false, false, builds, 0);

  const drain = async (): Promise<void> => {
    if (running || disposed) return;
    running = true;
    try {
      const pipelineState = await pipelinePromise;
      while (!disposed && pendingPlan) {
        const plan = pendingPlan;
        pendingPlan = null;
        submitFarSummaryRenderAtlasPlan(options, pipelineState, back, frontGpu, width, height, plan);
        commitPlan(view, plan);
        builds++;
        submittedSignature = plan.signature;
        publishRenderAtlasCounters(view, pendingPlan !== null, true, builds, plan.tiles.length);
      }
    } catch (error) {
      console.warn("[far-summary-render-atlas] GPU build failed; retaining previous atlas", error);
    } finally {
      running = false;
      publishRenderAtlasCounters(view, pendingPlan !== null, false, builds, 0);
      if (!disposed && pendingPlan) void drain();
    }
  };

  return {
    view,
    update(center, _frameIndex) {
      if (disposed) return;
      const plan = planFarSummaryGpuRenderAtlas(center, options.config, ++revision);
      if (plan.signature === submittedSignature || plan.signature === pendingPlan?.signature) return;
      pendingPlan = plan;
      publishRenderAtlasCounters(view, true, running, builds, plan.tiles.length);
      void drain();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      pendingPlan = null;
      if (activeAtlasView === view) activeAtlasView = undefined;
      disposeFarSummaryRenderAtlasFrontTextures(front);
      destroyFarSummaryRenderAtlasTextureSet(back);
      publishRenderAtlasCounters(view, false, false, builds, 0, false);
    },
  };
}

function commitPlan(view: FarSummaryGpuAtlasView, plan: FarSummaryGpuRenderAtlasPlan): void {
  for (let index = 0; index < view.rings.length; index++) {
    const next = plan.rings[index];
    if (!next) continue;
    Object.assign(view.rings[index]!, next);
  }
  const first = plan.rings[0];
  if (first) {
    view.originX = first.originX;
    view.originZ = first.originZ;
    view.cellM = first.cellM;
  }
  view.valid = plan.rings.length > 0 ? 1 : 0;
  view.revision++;
}

function emptyRingView(
  ring: { cellM: number; startM: number; endM: number },
  ringIndex: number,
  ringHeight: number,
  width: number,
): FarSummaryGpuAtlasRingView {
  return {
    originX: 0,
    originZ: 0,
    cellM: ring.cellM,
    startM: ring.startM,
    endM: ring.endM,
    rowOffsetCells: ringIndex * ringHeight,
    widthCells: width,
    heightCells: ringHeight,
    valid: 0,
  };
}

function publishRenderAtlasCounters(
  view: FarSummaryGpuAtlasView,
  pending: boolean,
  inFlight: boolean,
  builds: number,
  tiles: number,
  enabled = true,
): void {
  const counters = (globalThis as typeof globalThis & {
    window?: { __drusnielClod?: { stats?: { counters?: Record<string, number> } } };
  }).window?.__drusnielClod?.stats?.counters;
  if (!counters) return;
  counters["farSummaryRenderAtlas.enabled"] = enabled ? 1 : 0;
  counters["farSummaryRenderAtlas.valid"] = view.valid;
  counters["farSummaryRenderAtlas.revision"] = view.revision;
  counters["farSummaryRenderAtlas.builds"] = builds;
  counters["farSummaryRenderAtlas.tilesSubmitted"] = tiles;
  counters["farSummaryRenderAtlas.pending"] = pending ? 1 : 0;
  counters["farSummaryRenderAtlas.inFlight"] = inFlight ? 1 : 0;
}
