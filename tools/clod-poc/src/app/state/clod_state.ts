import phase0ConfigText from "../../../config/infinite_streaming_phase0.yaml?raw";
import type { ClodPagesConfig } from "../../config.js";
import { parsePhase0Config } from "../../phase0/phase0_config.js";
import type { ProjectSessionState } from "../../project/voxel_project_archive.js";
import { FAR_SHELL_DEFAULTS } from "../clod_constants.js";
import { assignArchiveFields } from "./archive_fields.js";
import { isRpgDensityScene } from "../../scenes/rpg_density_scenes.js";

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
  terrainStreamingEnabled: boolean;
  bubble: boolean;
  liveBubblePinned: boolean;
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

export interface LiveBubbleDefault {
  enabled: boolean;
  radiusM: number;
  pinned?: boolean;
}

const CLOD_ARCHIVE_KEYS = [
  "thresholdPx", "enforce21", "freeze", "wireframe", "showBounds", "showSeamPoints",
  "showCrossLodBorders", "colorByLod", "normalColor", "normalDivergence", "divergenceGain",
  "frontSideOnly", "recomputedNormals", "forceMaxLevel", "bubble", "bubbleRadius", "tintBubble",
] as const satisfies readonly (keyof ProjectSessionState)[];

const INFINITE_ISLANDS_SCENE = "infinite-islands";
const phase0Streaming = parsePhase0Config(phase0ConfigText).phase0.streaming;

function currentSearchParams(): URLSearchParams {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

function booleanParam(params: URLSearchParams, key: string): boolean | null {
  const raw = params.get(key);
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  return null;
}

function positiveParam(params: URLSearchParams, key: string): number | null {
  const parsed = Number(params.get(key));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

export function usesLiveBubbleByDefault(scene: string | null): boolean {
  return scene === INFINITE_ISLANDS_SCENE || isRpgDensityScene(scene);
}

export function liveBubbleDefaultForParams(
  cfg: ClodPagesConfig,
  params: URLSearchParams,
): LiveBubbleDefault | undefined {
  const sceneDefault = usesLiveBubbleByDefault(params.get("scene"));
  const enabledOverride = booleanParam(params, "liveBubble");
  const radiusOverride = positiveParam(params, "liveBubbleRadius");
  if (!sceneDefault && enabledOverride === null && radiusOverride === null) return undefined;

  const defaultRadius = sceneDefault
    ? phase0Streaming.live_radius_m
    : cfg.near_field.radius_chunks * cfg.page.chunk_size;
  const maxRadius = Math.max(1, phase0Streaming.clod_radius_m / 2);
  const enabled = enabledOverride ?? sceneDefault;
  return {
    enabled,
    radiusM: Math.min(radiusOverride ?? defaultRadius, maxRadius),
    pinned: enabled && (sceneDefault || enabledOverride === true),
  };
}

function queryLiveBubbleDefault(cfg: ClodPagesConfig): LiveBubbleDefault | undefined {
  return liveBubbleDefaultForParams(cfg, currentSearchParams());
}

export function applyLiveBubbleDefault(
  target: ClodSliceState,
  liveBubbleDefault?: LiveBubbleDefault,
): void {
  if (!liveBubbleDefault) return;
  target.bubble = liveBubbleDefault.enabled;
  target.liveBubblePinned = liveBubbleDefault.pinned ?? liveBubbleDefault.enabled;
  if (finiteNonNegative(liveBubbleDefault.radiusM)) target.bubbleRadius = liveBubbleDefault.radiusM;
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
    terrainStreamingEnabled: true,
    bubble: false,
    liveBubblePinned: false,
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
  return state;
}

export function applyClodArchiveState(target: ClodSliceState, archive: ProjectSessionState): void {
  assignArchiveFields(target, archive, CLOD_ARCHIVE_KEYS);
}
