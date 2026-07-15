import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { PlayerController, PlayerInteractionState } from "../../player_controller.js";
import type {
  NearFieldBubbleController,
  NearFieldBubbleStats,
  NearFieldBubbleView,
} from "../../terrain/near_field/near_field_bubble_controller.js";
import type { ClodSelectionController } from "../../terrain/selection/clod_selection_controller.js";
import { resetRootHeightMorph } from "../../terrain/streaming/root_height_morph.js";
import type { ClodFrameLoopUiState } from "./ui_state.js";
import type { ClodPageNode } from "../../types.js";
import { computeWorldCenterDebugStats, publishWorldCenterStatsToCounters } from "../../stream/world_center_debug.js";
import { runtimeWorldUsesCameraRelativeCoordinates } from "../../world/runtime_world_policy.js";

const RING_CLAMP_MARGIN = 2;

const CANONICAL_CENTER_SOURCE_CODE = {
  playing_player: 1,
  orbit_spawned_player: 2,
  orbit_camera: 3,
  orbit_target: 4,
} as const;

type CanonicalCenterSource = keyof typeof CANONICAL_CENTER_SOURCE_CODE;

let liveBubbleBuiltTotal = 0;
let liveBubbleEvictionsTotal = 0;
let liveBubbleLastColliderRemovals: number | null = null;
let liveBubbleProbeActive = false;
let liveBubbleProbeBuiltTotal = 0;
let liveBubbleProbeEvictionsTotal = 0;
let liveBubbleProbeColliderRemovalsTotal = 0;
let liveBubbleProbeCpuWorkUnitMaxMs = 0;

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
  __drusnielPerf?: { reset(): void };
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
  /** Canonical world-space center for the frame (player in play mode, orbit target otherwise).
   *  Far systems (far clipmap rings, far shell) anchor to this so they align with the near bubble. */
  worldCenter: THREE.Vector3;
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
      maybeWindow.__drusnielPerf?.reset();
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
  counters["live_bubble_probe_cpu_work_unit_max_ms"] = 0;
}

export function beginLiveBubbleMovementProbe(): void {
  const currentColliderRemovals = hooksCounters()?.["live_bubble_collider_removals"];
  liveBubbleBuiltTotal = 0;
  liveBubbleProbeActive = true;
  liveBubbleProbeBuiltTotal = 0;
  liveBubbleProbeEvictionsTotal = 0;
  liveBubbleProbeColliderRemovalsTotal = 0;
  liveBubbleProbeCpuWorkUnitMaxMs = 0;
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
    liveBubbleProbeCpuWorkUnitMaxMs = Math.max(liveBubbleProbeCpuWorkUnitMaxMs, stats.cpuWorkUnitMaxMs);
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
  counters["live_bubble_cpu_work_unit_max_ms"] = stats.cpuWorkUnitMaxMs;
  counters["live_bubble_probe_active"] = liveBubbleProbeActive ? 1 : 0;
  counters["live_bubble_probe_built_total"] = liveBubbleProbeBuiltTotal;
  counters["live_bubble_probe_evictions_total"] = liveBubbleProbeEvictionsTotal;
  counters["live_bubble_probe_collider_removals_total"] = liveBubbleProbeColliderRemovalsTotal;
  counters["live_bubble_probe_cpu_work_unit_max_ms"] = liveBubbleProbeCpuWorkUnitMaxMs;
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

function mirrorVegetationRingStats(cameraCenter: THREE.Vector3, grassCenter: THREE.Vector3, ringCenter: THREE.Vector3, unbounded: boolean): void {
  const counters = hooksCounters();
  if (!counters) return;
  counters["vegetation_ring_unbounded"] = unbounded ? 1 : 0;
  counters["vegetation_ring_center_x"] = ringCenter.x;
  counters["vegetation_ring_center_z"] = ringCenter.z;
  counters["vegetation_grass_center_x"] = grassCenter.x;
  counters["vegetation_grass_center_z"] = grassCenter.z;
  counters["vegetation_ring_distance_to_grass_m"] = Math.hypot(ringCenter.x - grassCenter.x, ringCenter.z - grassCenter.z);
  publishWorldCenterStatsToCounters(counters, computeWorldCenterDebugStats({
    camera: cameraCenter,
    vegetationRingCenter: ringCenter,
    vegetationGrassCenter: grassCenter,
    vegetationTreesCenter: ringCenter,
  }));
}

function canonicalWorldCenter(input: TerrainFramePhaseInput): CanonicalCenter {
  // One canonical center for every streaming system (near bubble, streamed CLOD roots, rings,
  // vegetation, far shell). Play mode -> player. Infinite-islands orbit mode -> the spawned
  // player (stays at the start instead of dragging pages with the orbiting eye), falling back
  // to the camera before spawn; acceptance gates assert centers track the camera XZ here.
  // Other scenes -> the orbit target.
  if (input.interaction.mode === "playing") {
    return { center: input.player.position, source: "playing_player" };
  }
  if (runtimeWorldUsesCameraRelativeCoordinates()) {
    if (input.player.spawned) {
      return { center: input.player.position, source: "orbit_spawned_player" };
    }
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

function applyRootTransitionFade(view: TerrainFadeView): boolean {
  const transition = view.node.rootTransition;
  if (transition?.mode !== "fadeIn" && transition?.mode !== "fadeOut") return false;

  // Root height morph disabled: props/vegetation are GPU-scattered at the final analytic surface
  // height and cannot cheaply track a transient per-vertex Y morph, so morphing the terrain root
  // during an LOD crossfade left them floating. Terrain now renders at its true height throughout
  // the transition (the crossfade alpha still hides the swap); accepted tradeoff is a subtle LOD
  // height pop in place of floating props.
  const progress = THREE.MathUtils.clamp(transition.progress, 0, 1);
  const fade = transition.mode === "fadeOut" ? 1 - progress : progress;
  resetRootHeightMorph(view);
  view.fade = fade;
  view.target = transition.mode === "fadeOut" ? 0 : 1;
  view.mesh.visible = fade > 0.001;
  view.mat.setRootMorph(0);
  view.mat.setFade(fade, transition.mode !== "fadeOut", fade > 0.001 && fade < 0.999);
  return true;
}

export function runTerrainFramePhase(input: TerrainFramePhaseInput): TerrainFramePhaseResult {
  const cutSnapshot = input.selectionController.terrainCutSnapshot();
  const activeTerrainViews = cutSnapshot.activeTerrainViews as Set<TerrainFadeView>;
  const selectionStats = cutSnapshot.stats;
  const transitionViews = cutSnapshot.terrainViews as unknown as Set<TerrainFadeView>;
  for (const v of activeTerrainViews) {
    if (applyRootTransitionFade(v)) {
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

  const ringUnbounded = runtimeWorldUsesCameraRelativeCoordinates();
  const canonicalCenter = canonicalWorldCenter(input);
  mirrorCanonicalWorldCenter(input, canonicalCenter);
  const bubbleCenter = canonicalCenter.center;
  const bubbleStats = input.nearFieldBubbleController.update({
    enabled: input.state.bubble,
    bubbleRadius: input.state.bubbleRadius,
    bubbleCenter,
    bubbleViews: transitionViews as unknown as Set<NearFieldBubbleView>,
    getView: (nodeId) => input.views.get(nodeId) as unknown as NearFieldBubbleView | undefined,
    frameId: selectionStats.frameId,
  });
  mirrorLiveBubbleStats(bubbleStats);
  if (input.pruneRenderNodeCache) {
    input.pruneRenderNodeCache(cutSnapshot.protectedNodeIds, selectionStats.frameId);
  }

  const tPropsStart = performance.now();
  const grassCenter = bubbleCenter;
  const ringCenter = vegetationRingCenter(grassCenter, input.worldCells, ringUnbounded);
  mirrorVegetationRingStats(input.camera?.position ?? input.controls.object.position, grassCenter, ringCenter, ringUnbounded);

  return {
    chunkGroupsBuiltThisFrame: bubbleStats.chunkGroupsBuiltThisFrame,
    bubbleStats,
    tBubbleStart: tPropsStart - bubbleStats.bubbleMs,
    tPropsStart,
    ringCenter,
    grassCenter,
    worldCenter: bubbleCenter,
  };
}
