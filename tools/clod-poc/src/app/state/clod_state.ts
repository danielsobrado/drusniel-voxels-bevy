import type { ClodPagesConfig } from "../../config.js";
import type { ProjectSessionState } from "../../project/voxel_project_archive.js";
import { FAR_SHELL_DEFAULTS } from "../clod_constants.js";
import { assignArchiveFields } from "./archive_fields.js";

const INFINITE_ISLANDS_SCENE = "infinite-islands";
const INFINITE_ISLANDS_LIVE_RADIUS_M = 200;
const INFINITE_ISLANDS_CLOD_RADIUS_M = 2048;

export interface LiveBubbleDefault {
  enabled: boolean;
  radiusM: number;
}

export interface ClodSliceState {
  clodPerfMode: boolean;
  webgpuSelection: boolean;
  materialTiers: boolean;
  thresholdPx: number;
  enforce21: boolean;
  freeze: boolean;
  wireframe: boolean;
  showBounds: boolean;
  showSeamPoints: boolean;
  showCrossLodBorders: boolean;
  showNodeLabels: boolean;
  showLockedBorderVertices: boolean;
  colorByLod: boolean;
  normalColor: boolean;
  normalDivergence: boolean;
  divergenceGain: number;
  frontSideOnly: boolean;
  recomputedNormals: boolean;
  forceMaxLevel: string;
  bubble: boolean;
  bubbleRadius: number;
  tintBubble: boolean;
  profileEnabled: boolean;
  farShellEnabled: boolean;
  farShellRadiusFactor: number;
  farShellHeightBias: number;
  farShellHeightDrop: number;
  longViewInfiniteShellEnabled: boolean;
  longViewInfiniteShellWireframe: boolean;
  longViewShowShellRings: boolean;
  longViewShowMissingSummaryFallback: boolean;
  longViewShowFarSummaryTiles: boolean;
  longViewFreezeStreamCenter: boolean;
  longViewForceMissingTiles: boolean;
  longViewRebuildBudget: number;
  clodShadowOverlayMode: "off" | "casters" | "all";
  clodShadowProxyView: "off" | "proxy-meshes";
  clodShadowProxyWireframe: boolean;
  clodShadowStatsLine: string;
}

const CLOD_ARCHIVE_KEYS = [
  "thresholdPx", "enforce21", "freeze", "wireframe", "showBounds", "showSeamPoints",
  "showCrossLodBorders", "colorByLod", "normalColor", "normalDivergence", "divergenceGain",
  "frontSideOnly", "recomputedNormals", "forceMaxLevel", "bubble", "bubbleRadius", "tintBubble",
] as const satisfies readonly (keyof ProjectSessionState)[];

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function queryParams(): URLSearchParams | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search);
}

function booleanParam(params: URLSearchParams, key: string): boolean | null {
  const value = params.get(key);
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return null;
}

function positiveParam(params: URLSearchParams, key: string): number | null {
  const value = Number(params.get(key));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function queryLiveBubbleDefault(cfg: ClodPagesConfig): LiveBubbleDefault | undefined {
  const params = queryParams();
  if (!params) return undefined;
  const sceneDefault = params.get("scene") === INFINITE_ISLANDS_SCENE;
  const enabledOverride = booleanParam(params, "liveBubble");
  const radiusOverride = positiveParam(params, "liveBubbleRadius");
  if (!sceneDefault && enabledOverride === null && radiusOverride === null) return undefined;
  const defaultRadius = sceneDefault ? INFINITE_ISLANDS_LIVE_RADIUS_M : cfg.near_field.radius_chunks * cfg.page.chunk_size;
  return {
    enabled: enabledOverride ?? sceneDefault,
    radiusM: Math.min(radiusOverride ?? defaultRadius, INFINITE_ISLANDS_CLOD_RADIUS_M / 2),
  };
}

export function applyLiveBubbleDefault(
  target: Pick<ClodSliceState, "bubble" | "bubbleRadius">,
  liveBubbleDefault?: LiveBubbleDefault,
): void {
  if (!liveBubbleDefault) return;
  target.bubble = liveBubbleDefault.enabled;
  if (finiteNonNegative(liveBubbleDefault.radiusM)) target.bubbleRadius = liveBubbleDefault.radiusM;
}

function preserveEnabledBubble(target: ClodSliceState, liveBubbleDefault?: LiveBubbleDefault): void {
  if (!liveBubbleDefault?.enabled) return;
  let value = true;
  Object.defineProperty(target, "bubble", {
    enumerable: true,
    configurable: true,
    get: () => value,
    set: () => { value = true; },
  });
}

export function createClodSliceState(input: {
  cfg: ClodPagesConfig;
  queryPerfMode: boolean;
  queryWebGpuSelection: boolean;
  queryMaterialTiers: boolean;
  queryFarShell: boolean;
  isLongView: boolean;
  profileEnabled: boolean;
  liveBubbleDefault?: LiveBubbleDefault;
}): ClodSliceState {
  const state: ClodSliceState = {
    clodPerfMode: input.queryPerfMode,
    webgpuSelection: input.queryWebGpuSelection,
    materialTiers: input.queryMaterialTiers,
    thresholdPx: input.cfg.selection.error_threshold_px,
    enforce21: true,
    freeze: false,
    wireframe: false,
    showBounds: false,
    showSeamPoints: false,
    showCrossLodBorders: false,
    showNodeLabels: false,
    showLockedBorderVertices: false,
    colorByLod: input.queryPerfMode,
    normalColor: false,
    normalDivergence: false,
    divergenceGain: 8,
    frontSideOnly: false,
    recomputedNormals: false,
    forceMaxLevel: "auto",
    bubble: false,
    bubbleRadius: input.cfg.near_field.radius_chunks * input.cfg.page.chunk_size,
    tintBubble: true,
    profileEnabled: input.profileEnabled,
    farShellEnabled: FAR_SHELL_DEFAULTS.enabled,
    farShellRadiusFactor: FAR_SHELL_DEFAULTS.radiusFactor,
    farShellHeightBias: FAR_SHELL_DEFAULTS.heightBias,
    farShellHeightDrop: FAR_SHELL_DEFAULTS.heightDrop,
    longViewInfiniteShellEnabled: true,
    longViewInfiniteShellWireframe: false,
    longViewShowShellRings: false,
    longViewShowMissingSummaryFallback: false,
    longViewShowFarSummaryTiles: false,
    longViewFreezeStreamCenter: false,
    longViewForceMissingTiles: false,
    longViewRebuildBudget: 4,
    clodShadowOverlayMode: "off",
    clodShadowProxyView: "off",
    clodShadowProxyWireframe: true,
    clodShadowStatsLine: "",
  };
  const liveBubbleDefault = input.liveBubbleDefault ?? queryLiveBubbleDefault(input.cfg);
  applyLiveBubbleDefault(state, liveBubbleDefault);
  preserveEnabledBubble(state, liveBubbleDefault);
  return state;
}

export function applyClodArchiveState(target: ClodSliceState, archive: ProjectSessionState): void {
  assignArchiveFields(target, archive, CLOD_ARCHIVE_KEYS);
}
