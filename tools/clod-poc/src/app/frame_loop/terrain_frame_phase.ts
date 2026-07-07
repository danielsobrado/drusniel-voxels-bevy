import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { PlayerController, PlayerInteractionState } from "../../player_controller.js";
import type {
  NearFieldBubbleController,
  NearFieldBubbleStats,
  NearFieldBubbleView,
} from "../../terrain/near_field/near_field_bubble_controller.js";
import type { ClodSelectionController } from "../../terrain/selection/clod_selection_controller.js";
import {
  applyRootHeightMorph,
  resetRootHeightMorph,
} from "../../terrain/streaming/root_height_morph.js";
import type { ClodFrameLoopUiState } from "./ui_state.js";
import type { ClodPageNode } from "../../types.js";

const INFINITE_ISLANDS_SCENE = "infinite-islands";
const RING_CLAMP_MARGIN = 2;

const CANONICAL_CENTER_SOURCE_CODE = {
  playing_player: 1,
  orbit_spawned_player: 2,
  orbit_camera: 3,
  orbit_target: 4,
} as const;

type CanonicalCenterSource = keyof typeof CANONICAL_CENTER_SOURCE_CODE;

let cachedInfiniteIslandsScene: boolean | null = null;
let liveBubbleBuiltTotal = 0;
let liveBubbleEvictionsTotal = 0;
let liveBubbleLastColliderRemovals: number | null = null;
let liveBubbleProbeActive = false;
let liveBubbleProbeBuiltTotal = 0;
let liveBubbleProbeEvictionsTotal = 0;
let liveBubbleProbeColliderRemovalsTotal = 0;

interface TerrainFadeView {
  node: Pick<ClodPageNode, "id" | "mesh" | "rootTransition">;
  fade: number;
  target: number;
  mesh: THREE.Mesh;
  mat: {
    setFade: (fade: number, fadeIn: boolean, dither: boolean) => void;
    setRootMorph: (influence: number) => void;
  };
}

interface MovementProbeWindow {
  __drusnielClod?: {
    beginMovementRouteProbe?: (() => void) | null;
    stats?: { counters?: Record<string, number> };
  };
  __drusnielBeginLiveBubbleMovementProbe?: () => void;
  __drusnielBeginStreamingMovementProbe?: () => void;
}

interface RootMorphFrameStats {
  builtRoots: number;
  builtVertices: number;
  buildMs: number;
}

interface CanonicalCenter {
  center: THREE.Vector3;
  source: CanonicalCenterSource;
}

export interface TerrainFramePhaseInput {
  state: ClodFrameLoopUiState;
  pageTransitionMode: string;
  crossfadeStep: number;
  interaction: PlayerInteractionState;
  player: PlayerController;
  controls: OrbitControls;
  camera?: THREE.Camera;
  selectionController: ClodSelectionController;
  nearFieldBubbleController: NearFieldBubbleController;
  views: Map<string, { node: { id: string }; fade: number; target: number; mesh: THREE.Mesh; mat: { setFade: (fade: number, fadeIn: boolean, dither: boolean) => void } }>;
  worldCells: number;
  pruneRenderNodeCache?: (protectedNodeIds: ReadonlySet<string>, frameId: number) => void;
}

export interface TerrainFramePhaseResult {
  chunkGroupsBuiltThisFrame: number;
  bubbleStats: NearFieldBubbleStats;
  tBubbleStart: number;
  tPropsStart: number;
  ringCenter: THREE.Vector3;
  grassCenter: THREE.Vector3;
}

function hooksCounters(): Record<string, number> | null {
  const hooks = (globalThis as typeof globalThis & { window?: MovementProbeWindow }).window?.__drusnielClod;
  return hooks?.stats?.counters ?? null;
}

function registerGlobalLiveBubbleProbe(): void {
  const maybeWindow = (globalThis as typeof globalThis & { window?: MovementProbeWindow }).window;
  if (!maybeWindow) return;
  maybeWindow.__drusnielBeginLiveBubbleMovementProbe = beginLiveBubbleMovementProbe;
  if (maybeWindow.__drusnielClod) {
    maybeWindow.__drusnielClod.beginMovementRouteProbe = () => {
      beginLiveBubbleMovementProbe();
      maybeWindow.__drusnielBeginStreamingMovementProbe?.();
    };
  }
}

function resetLiveBubbleCounterMirrors(): void {
  const counters = hooksCounters();
  if (!counters) return;
  counters["live_bubble_built_total"] = 0;
  counters["live_bubble_probe_active"] = 1;
  counters["live_bubble_probe_built_total"] = 0;
  counters["live_bubble_probe_evictions_total"] = 0;
  counters["live_bubble_probe_collider_removals_total"] = 0;
}

export function beginLiveBubbleMovementProbe(): void {
  const currentColliderRemovals = hooksCounters()?.["live_bubble_collider_removals"];
  liveBubbleBuiltTotal = 0;
  liveBubbleProbeActive = true;
  liveBubbleProbeBuiltTotal = 0;
  liveBubbleProbeEvictionsTotal = 0;
  liveBubbleProbeColliderRemovalsTotal = 0;
  liveBubbleLastColliderRemovals = Number.isFinite(currentColliderRemovals) ? currentColliderRemovals! : null;
  resetLiveBubbleCounterMirrors();
}

function mirrorLiveBubbleStats(stats: NearFieldBubbleStats): void {
  const counters = hooksCounters();
  registerGlobalLiveBubbleProbe();
  if (!counters) return;
  const colliderRemovalDelta = liveBubbleLastColliderRemovals === null
    ? 0
    : Math.max(0, stats.colliderRemovals - liveBubbleLastColliderRemovals);
  liveBubbleLastColliderRemovals = stats.colliderRemovals;
  liveBubbleBuiltTotal += stats.chunkGroupsBuiltThisFrame;
  liveBubbleEvictionsTotal += stats.evictions;
  if (liveBubbleProbeActive) {
    liveBubbleProbeBuiltTotal += stats.chunkGroupsBuiltThisFrame;
    liveBubbleProbeEvictionsTotal += stats.evictions;
    liveBubbleProbeColliderRemovalsTotal += colliderRemovalDelta;
  }
  counters["live_bubble_required_pages"] = stats.requiredPages;
  counters["live_bubble_ready_pages"] = stats.readyPages;
  counters["live_bubble_building_pages"] = Math.max(stats.buildingPages, stats.gpuRetryPages);
  counters["live_bubble_failed_pages"] = stats.failedPages;
  counters["live_bubble_valid_empty_pages"] = stats.validEmptyPages;
  counters["live_bubble_gpu_retry_pages"] = stats.gpuRetryPages;
  counters["live_bubble_gpu_retries_total"] = stats.gpuRetriesTotal;
  counters["live_bubble_gpu_failures_total"] = stats.gpuTerminalFailuresTotal;
  counters["live_bubble_built_this_frame"] = stats.chunkGroupsBuiltThisFrame;
  counters["live_bubble_built_total"] = liveBubbleProbeActive ? liveBubbleProbeBuiltTotal : liveBubbleBuiltTotal;
  counters["live_bubble_ms"] = stats.bubbleMs;
  counters["live_bubble_evictions"] = stats.evictions;
  counters["live_bubble_evictions_total"] = liveBubbleEvictionsTotal;
  counters["live_bubble_cached_pages"] = stats.chunkGroupCount;
  counters["live_bubble_streamed_collider_pages"] = stats.streamedColliderPages;
  counters["live_bubble_collider_registrations"] = stats.colliderRegistrations;
  counters["live_bubble_collider_removals"] = stats.colliderRemovals;
  counters["live_bubble_gpu_dispatch_budget"] = stats.gpuDispatchBudget;
  counters["live_bubble_max_inflight_chunks"] = stats.gpuMaxInflightChunks;
  counters["live_bubble_pending_chunks"] = stats.pendingChunks;
  counters["live_bubble_inflight_chunks"] = stats.inflightChunks;
  counters["live_bubble_ready_visual_pages"] = stats.readyVisualPages;
  counters["live_bubble_avg_chunk_ms"] = stats.avgChunkMs;
  counters["live_bubble_slowest_page_ms"] = stats.slowestPageMs;
  counters["live_bubble_visual_required_pages"] = stats.visualRequiredPages;
  counters["live_bubble_visual_ready_pages"] = stats.visualReadyPages;
  counters["live_bubble_collider_required_pages"] = stats.colliderRequiredPages;
  counters["live_bubble_collider_ready_pages"] = stats.colliderReadyPages;
  counters["live_bubble_collider_skipped_pages"] = stats.colliderSkippedPages;
  counters["live_bubble_probe_active"] = liveBubbleProbeActive ? 1 : 0;
  counters["live_bubble_probe_built_total"] = liveBubbleProbeBuiltTotal;
  counters["live_bubble_probe_evictions_total"] = liveBubbleProbeEvictionsTotal;
  counters["live_bubble_probe_collider_removals_total"] = liveBubbleProbeColliderRemovalsTotal;
}

function mirrorCanonicalWorldCenter(input: TerrainFramePhaseInput, canonical: CanonicalCenter): void {
  const counters = hooksCounters();
  if (!counters) return;
  counters["canonical_world_center_x"] = canonical.center.x;
  counters["canonical_world_center_z"] = canonical.center.z;
  counters["canonical_world_center_source"] = CANONICAL_CENTER_SOURCE_CODE[canonical.source];
  counters["canonical_world_player_spawned"] = input.player.spawned ? 1 : 0;
  counters["canonical_world_player_x"] = input.player.position.x;
  counters["canonical_world_player_z"] = input.player.position.z;
  counters["canonical_world_camera_x"] = input.camera?.position.x ?? input.controls.object.position.x;
  counters["canonical_world_camera_z"] = input.camera?.position.z ?? input.controls.object.position.z;
  counters["canonical_world_target_x"] = input.controls.target.x;
  counters["canonical_world_target_z"] = input.controls.target.z;
}

function mirrorVegetationRingStats(grassCenter: THREE.Vector3, ringCenter: THREE.Vector3, unbounded: boolean): void {
  const counters = hooksCounters();
  if (!counters) return;
  counters["vegetation_ring_unbounded"] = unbounded ? 1 : 0;
  counters["vegetation_ring_center_x"] = ringCenter.x;
  counters["vegetation_ring_center_z"] = ringCenter.z;
  counters["vegetation_grass_center_x"] = grassCenter.x;
  counters["vegetation_grass_center_z"] = grassCenter.z;
  counters["vegetation_ring_distance_to_grass_m"] = Math.hypot(ringCenter.x - grassCenter.x, ringCenter.z - grassCenter.z);
}

function mirrorRootMorphStats(stats: RootMorphFrameStats): void {
  const counters = hooksCounters();
  if (!counters) return;
  counters["live_clod_stream_transition_height_morph_roots"] = stats.builtRoots;
  counters["live_clod_stream_transition_height_morph_vertices"] = stats.builtVertices;
  counters["live_clod_stream_transition_height_morph_build_ms"] = stats.buildMs;
}

function infiniteIslandsScene(): boolean {
  if (cachedInfiniteIslandsScene !== null) return cachedInfiniteIslandsScene;
  const search = globalThis.location?.search;
  cachedInfiniteIslandsScene = search ? new URLSearchParams(search).get("scene") === INFINITE_ISLANDS_SCENE : false;
  return cachedInfiniteIslandsScene;
}

function canonicalWorldCenter(input: TerrainFramePhaseInput, infiniteScene: boolean): CanonicalCenter {
  if (input.interaction.mode === "playing") {
    return { center: input.player.position, source: "playing_player" };
  }
  if (infiniteScene && input.player.spawned) {
    return { center: input.player.position, source: "orbit_spawned_player" };
  }
  if (infiniteScene) {
    return { center: input.camera?.position ?? input.controls.object.position, source: "orbit_camera" };
  }
  return { center: input.controls.target, source: "orbit_target" };
}

export function vegetationRingCenter(grassCenter: THREE.Vector3, worldCells: number, unbounded: boolean): THREE.Vector3 {
  if (unbounded) return grassCenter.clone();
  return new THREE.Vector3(
    THREE.MathUtils.clamp(grassCenter.x, RING_CLAMP_MARGIN, worldCells - RING_CLAMP_MARGIN),
    grassCenter.y,
    THREE.MathUtils.clamp(grassCenter.z, RING_CLAMP_MARGIN, worldCells - RING_CLAMP_MARGIN),
  );
}

function buildTransitionGroups(views: Iterable<TerrainFadeView>): Map<number, TerrainFadeView[]> {
  const groups = new Map<number, TerrainFadeView[]>();
  for (const view of views) {
    const transition = view.node.rootTransition;
    if (transition?.mode !== "fadeIn" && transition?.mode !== "fadeOut") continue;
    const group = groups.get(transition.groupId);
    if (group) group.push(view);
    else groups.set(transition.groupId, [view]);
  }
  return groups;
}

function sourceViewsForMorph(view: TerrainFadeView, groups: ReadonlyMap<number, TerrainFadeView[]>): TerrainFadeView[] {
  const transition = view.node.rootTransition;
  if (!transition) return [];
  const oppositeMode = transition.mode === "fadeIn" ? "fadeOut" : transition.mode === "fadeOut" ? "fadeIn" : "";
  if (!oppositeMode) return [];
  return (groups.get(transition.groupId) ?? []).filter((candidate) => candidate.node.rootTransition?.mode === oppositeMode);
}

function applyRootTransitionFade(
  view: TerrainFadeView,
  transitionGroups: ReadonlyMap<number, TerrainFadeView[]>,
  morphStats: RootMorphFrameStats,
): boolean {
  const transition = view.node.rootTransition;
  if (transition?.mode !== "fadeIn" && transition?.mode !== "fadeOut") return false;

  const progress = THREE.MathUtils.clamp(transition.progress, 0, 1);
  const fade = transition.mode === "fadeOut" ? 1 - progress : progress;
  const morphInfluence = transition.mode === "fadeIn" ? 1 - progress : progress;
  const built = applyRootHeightMorph(view, sourceViewsForMorph(view, transitionGroups));
  morphStats.builtRoots += built.builtRoots;
  morphStats.builtVertices += built.builtVertices;
  morphStats.buildMs += built.buildMs;
  view.fade = fade;
  view.target = transition.mode === "fadeOut" ? 0 : 1;
  view.mesh.visible = fade > 0.001;
  view.mat.setRootMorph(morphInfluence);
  view.mat.setFade(fade, transition.mode !== "fadeOut", fade > 0.001 && fade < 0.999);
  return true;
}

export function runTerrainFramePhase(input: TerrainFramePhaseInput): TerrainFramePhaseResult {
  const activeTerrainViews = input.selectionController.activeTerrainViews() as Set<TerrainFadeView>;
  const currentTerrainViews = input.selectionController.currentTerrainViews() as Set<TerrainFadeView>;
  const selectionStats = input.selectionController.stats();
  const transitionViews = new Set<TerrainFadeView>([...currentTerrainViews, ...activeTerrainViews]);
  const transitionGroups = buildTransitionGroups(transitionViews);
  const morphStats: RootMorphFrameStats = { builtRoots: 0, builtVertices: 0, buildMs: 0 };

  for (const v of activeTerrainViews) {
    if (applyRootTransitionFade(v, transitionGroups, morphStats)) {
      const progress = v.node.rootTransition?.progress ?? 1;
      if (progress >= 1) activeTerrainViews.delete(v);
      continue;
    }
    resetRootHeightMorph(v);
    v.mat.setRootMorph(0);
    if (input.pageTransitionMode === "instant") {
      v.fade = v.target;
      v.mesh.visible = v.target > 0.5;
      v.mat.setFade(1, v.target > 0.5, false);
      activeTerrainViews.delete(v);
      continue;
    }
    if (v.fade < v.target) v.fade = Math.min(v.target, v.fade + input.crossfadeStep);
    else if (v.fade > v.target) v.fade = Math.max(v.target, v.fade - input.crossfadeStep);
    v.mesh.visible = v.fade > 0.001;
    v.mat.setFade(v.fade, v.target > 0.5, v.fade > 0.001 && v.fade < 0.999);
    if (v.fade === v.target) activeTerrainViews.delete(v);
  }
  mirrorRootMorphStats(morphStats);

  const ringUnbounded = infiniteIslandsScene();
  const canonicalCenter = canonicalWorldCenter(input, ringUnbounded);
  mirrorCanonicalWorldCenter(input, canonicalCenter);
  const bubbleCenter = canonicalCenter.center;
  const bubbleStats = input.nearFieldBubbleController.update({
    enabled: input.state.bubble,
    bubbleRadius: input.state.bubbleRadius,
    bubbleCenter,
    bubbleViews: new Set([...currentTerrainViews, ...activeTerrainViews]) as unknown as Set<NearFieldBubbleView>,
    getView: (nodeId) => input.views.get(nodeId) as unknown as NearFieldBubbleView | undefined,
    frameId: selectionStats.frameId,
  });
  mirrorLiveBubbleStats(bubbleStats);
  if (input.pruneRenderNodeCache) {
    const protectedNodeIds = new Set<string>();
    for (const view of currentTerrainViews) protectedNodeIds.add(view.node.id);
    for (const view of activeTerrainViews) protectedNodeIds.add(view.node.id);
    input.pruneRenderNodeCache(protectedNodeIds, selectionStats.frameId);
  }

  const tPropsStart = performance.now();
  const grassCenter = bubbleCenter;
  const ringCenter = vegetationRingCenter(grassCenter, input.worldCells, ringUnbounded);
  mirrorVegetationRingStats(grassCenter, ringCenter, ringUnbounded);

  return {
    chunkGroupsBuiltThisFrame: bubbleStats.chunkGroupsBuiltThisFrame,
    bubbleStats,
    tBubbleStart: tPropsStart - bubbleStats.bubbleMs,
    tPropsStart,
    ringCenter,
    grassCenter,
  };
}
