import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { PlayerController, PlayerInteractionState } from "../../player_controller.js";
import type {
  NearFieldBubbleController,
  NearFieldBubbleStats,
  NearFieldBubbleView,
} from "../../terrain/near_field/near_field_bubble_controller.js";
import type { ClodSelectionController } from "../../terrain/selection/clod_selection_controller.js";
import type { ClodFrameLoopUiState } from "./ui_state.js";

const INFINITE_ISLANDS_SCENE = "infinite-islands";
const RING_CLAMP_MARGIN = 2;

let cachedInfiniteIslandsScene: boolean | null = null;
let liveBubbleBuiltTotal = 0;
let liveBubbleEvictionsTotal = 0;
let liveBubbleLastColliderRemovals: number | null = null;
let liveBubbleProbeActive = false;
let liveBubbleProbeBuiltTotal = 0;
let liveBubbleProbeEvictionsTotal = 0;
let liveBubbleProbeColliderRemovalsTotal = 0;

interface TerrainFadeView {
  node: { id: string };
  fade: number;
  target: number;
  mesh: THREE.Mesh;
  mat: { setFade: (fade: number, fadeIn: boolean, dither: boolean) => void };
}

interface MovementProbeWindow {
  __drusnielClod?: {
    beginMovementRouteProbe?: (() => void) | null;
    stats?: { counters?: Record<string, number> };
  };
  __drusnielBeginLiveBubbleMovementProbe?: () => void;
  __drusnielBeginStreamingMovementProbe?: () => void;
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
  views: Map<string, { node: { id: string } } & TerrainFadeView>;
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

function infiniteIslandsScene(): boolean {
  if (cachedInfiniteIslandsScene !== null) return cachedInfiniteIslandsScene;
  const search = globalThis.location?.search;
  cachedInfiniteIslandsScene = search ? new URLSearchParams(search).get("scene") === INFINITE_ISLANDS_SCENE : false;
  return cachedInfiniteIslandsScene;
}

function canonicalWorldCenter(input: TerrainFramePhaseInput, infiniteScene: boolean): THREE.Vector3 {
  if (input.interaction.mode === "playing") return input.player.position;
  if (infiniteScene) return input.camera?.position ?? input.controls.object.position;
  return input.controls.target;
}

export function vegetationRingCenter(grassCenter: THREE.Vector3, worldCells: number, unbounded: boolean): THREE.Vector3 {
  if (unbounded) return grassCenter.clone();
  return new THREE.Vector3(
    THREE.MathUtils.clamp(grassCenter.x, RING_CLAMP_MARGIN, worldCells - RING_CLAMP_MARGIN),
    grassCenter.y,
    THREE.MathUtils.clamp(grassCenter.z, RING_CLAMP_MARGIN, worldCells - RING_CLAMP_MARGIN),
  );
}

export function runTerrainFramePhase(input: TerrainFramePhaseInput): TerrainFramePhaseResult {
  const activeTerrainViews = input.selectionController.activeTerrainViews() as Set<TerrainFadeView>;
  const currentTerrainViews = input.selectionController.currentTerrainViews();
  const selectionStats = input.selectionController.stats();

  for (const v of activeTerrainViews) {
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

  const ringUnbounded = infiniteIslandsScene();
  const bubbleCenter = canonicalWorldCenter(input, ringUnbounded);
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
