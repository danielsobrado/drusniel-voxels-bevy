import * as THREE from "three";
import { density, surfaceHeight } from "../terrain/terrain.js";
import { defaultConstructionConfig } from "./config.js";
import {
  CONSTRUCTION_MATERIAL_OPTIONS,
  constructionMaterialLabel,
  createConstructionMaterial,
} from "./materials.js";
import { preloadConstructionMaterialPreviews, preloadConstructionMaterialWindow } from "./material_preloader.js";
import { createConstructionCandidate, createFreePlacementPosition } from "./placement.js";
import { ConstructionSnapIndex } from "./snap_index.js";
import {
  ENTITY_ID_PREFIX,
  GHOST_INVALID_COLOR,
  createPieceGeometry,
  normalizeRotationQuarterTurns,
} from "./construction_controller_support.js";
import type {
  ConstructionCandidate,
  ConstructionConfig,
  ConstructionMaterial,
  ConstructionPieceDef,
  ConstructionTerrainConformHandler,
  ConstructionTerrainConformPreview,
  ConstructionTerrainConformRequest,
  PlacedConstructionPiece,
} from "./types.js";
import { trackedMeshBasicMaterial } from "../rendering/material_churn/tracked_material_factory.js";
import type {
  PlayerEditAuthorityConfig,
  PlayerEditAuthorityPoint,
} from "../player/player_edit_authority.js";
import {
  createEditCommand,
  type EditCommandDenialReason,
  type ModedEditCommand,
} from "../player/edit_commands.js";
import { getDigEditRevision } from "../terrain/terrain_edits.js";
import { ConstructionOverlapIndex } from "./overlap_index.js";
import { ConstructionPerformanceTracker, type ConstructionPerformanceSnapshot } from "./construction_timing.js";
import { raycastConstructionTerrain } from "./targeting.js";
import { findConstructionSnapCandidates, updateConstructionGhost } from "./construction_preview.js";
import { ConstructionSnapSelector } from "./construction_snap_selector.js";
import type { AuthoritativeConstructionTerrainHit } from "./targeting.js";
import { getActiveTerrainRaycastService } from "../player/terrain_raycast_registry.js";
import { ConstructionColliderSet } from "./construction_collider.js";
import { ConstructionPieceStore } from "./construction_piece_store.js";
import { authorizeConstructionRemoval } from "./construction_remove_authority.js";
import { reevaluateConstructionSupport, type ConstructionSupportAabb } from "./support_reevaluation.js";
import { loadConstructionPieces, saveConstructionPieces } from "./construction_persistence.js";
import { createConstructionTerrainConformRequest } from "./construction_terrain_conform.js";
import { createConstructionControllerUi, type ConstructionControllerUi } from "./construction_controller_ui.js";
import { findConstructionConnectionIds } from "./construction_connections.js";
import { ConstructionSupportGraph } from "./construction_support_graph.js";
import {
  ConstructionStabilityRuntime,
  type ConstructionStabilityRuntimeStats,
} from "./construction_stability_runtime.js";
import { getActiveConstructionTerrainConformHandler } from "./construction_terrain_registry.js";
import {
  commitConstructionPlacementTransaction,
  undoConstructionPlacementTransaction,
  type ConstructionPlacementUndoRecord,
} from "./construction_placement_transaction.js";
import { aimedConstructionPieceIndex, readConstructionAimRay } from "./construction_aim.js";
import {
  applyConstructionCommitAuthority,
  validateConstructionPlaceCommand,
} from "./construction_placement_session.js";
import {
  breakConstructionPiece,
  listConstructionPlacedPieces,
  placeConstructionPieceAt,
  type ConstructionBreakPieceInput,
  type ConstructionBreakPieceResult,
  type ConstructionListedPiece,
  type ConstructionPlacePieceAtInput,
  type ConstructionPlacePieceAtResult,
} from "./construction_automation_api.js";

const DEFAULT_OVERLAP_SPATIAL_CELL_M = 4;

export interface ConstructionControllerDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  rendererDomElement: HTMLElement;
  worldCells: number;
  config?: ConstructionConfig;
  editAuthority?: PlayerEditAuthorityConfig;
  getAuthorityOrigin?: () => PlayerEditAuthorityPoint | null;
  getAuthorityCounters?: () => Record<string, number> | null;
  raycastAuthoritativeTerrain?: (ray: THREE.Ray, maxDistance?: number) => AuthoritativeConstructionTerrainHit | null;
  /** Fail closed when a covering collider page is mid-rebuild at the place target. */
  constructionReadyAt?: (x: number, z: number) => boolean;
  getTerrainRevision?: () => number;
  getInteractionMode?: () => string;
  recordEditDenial?: (reason: EditCommandDenialReason) => void;
}

export interface ConstructionControllerStats {
  active: boolean;
  snapEnabled: boolean;
  selectedPieceId: string | null;
  placedPieces: number;
  indexedSnapPoints: number;
  indexedOverlapPieces: number;
  graphNodes: number;
  graphEdges: number;
  pendingCollapses: number;
  currentValid: boolean;
  currentReason: string | null;
  currentStability: number | null;
  terrainPreviewValid: boolean | null;
  terrainFillVolumeM3: number;
  terrainCutVolumeM3: number;
  placementInFlight: boolean;
  undoDepth: number;
  stability: ConstructionStabilityRuntimeStats;
  performance: ConstructionPerformanceSnapshot;
}

export type {
  ConstructionPlacePieceAtInput,
  ConstructionPlacePieceAtResult,
  ConstructionBreakPieceInput,
  ConstructionBreakPieceResult,
  ConstructionListedPiece,
} from "./construction_automation_api.js";

export type LegacyConstructionTerrainConformHandler = (request: ConstructionTerrainConformRequest) => void;

export interface ConstructionController {
  update(): void;
  dispose(): void;
  stats(): ConstructionControllerStats;
  setTerrainConformHandler(
    handler: ConstructionTerrainConformHandler | LegacyConstructionTerrainConformHandler | null,
  ): void;
  readonly colliderSet: ConstructionColliderSet;
  reevaluateSupportForTerrainEdit(aabb: ConstructionSupportAabb): void;
  /** Automation/authoritative place path used by edit-storm hooks (same transaction as player place). */
  placePieceAt(input: ConstructionPlacePieceAtInput): Promise<ConstructionPlacePieceAtResult>;
  /** Automation/authoritative break path used by edit-storm hooks (same removal as player delete). */
  breakPiece(input: ConstructionBreakPieceInput): ConstructionBreakPieceResult;
  listPlacedPieces(limit?: number): readonly ConstructionListedPiece[];
}

export function createConstructionController(deps: ConstructionControllerDeps): ConstructionController {
  return new ConstructionControllerImpl(deps);
}

class ConstructionControllerImpl implements ConstructionController {
  readonly colliderSet = new ConstructionColliderSet();
  private readonly config: ConstructionConfig;
  private readonly piecesById = new Map<string, ConstructionPieceDef>();
  private readonly root = new THREE.Group();
  private readonly snapIndex: ConstructionSnapIndex;
  private readonly overlapIndex: ConstructionOverlapIndex;
  private readonly supportGraph = new ConstructionSupportGraph();
  private readonly pieceStore: ConstructionPieceStore;
  private readonly stabilityRuntime: ConstructionStabilityRuntime;
  private readonly performance = new ConstructionPerformanceTracker();
  private readonly snapSelector = new ConstructionSnapSelector();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2(0, 0);
  private readonly centerNdc = new THREE.Vector2(0, 0);
  private readonly ghostMaterial: THREE.MeshBasicMaterial;
  private readonly ghostMesh: THREE.Mesh;
  private readonly ui: ConstructionControllerUi;
  private readonly undoStack: ConstructionPlacementUndoRecord[] = [];
  private active = false;
  private snapEnabled = true;
  private snapSuppressed = false;
  private selectedIndex = 0;
  private selectedMaterialIndex = 0;
  private rotationQuarterTurns = 0;
  private pointerInside = false;
  private currentCandidate: ConstructionCandidate | null = null;
  private currentTerrainRequest: ConstructionTerrainConformRequest | null = null;
  private currentTerrainPreview: ConstructionTerrainConformPreview | null = null;
  private nextEntityId = 1;
  private lastPlacementMessage = "";
  private supportReevaluations = 0;
  private ghostPieceId: string | null = null;
  private terrainConformHandler: ConstructionTerrainConformHandler | null = null;
  private placementInFlight = false;
  /** Immutable ghost place command; revalidated on click against the latest revision. */
  private pendingPlaceCommand: ModedEditCommand | null = null;

  constructor(private readonly deps: ConstructionControllerDeps) {
    this.config = deps.config ?? defaultConstructionConfig;
    for (const piece of this.config.pieces) this.piecesById.set(piece.id, piece);
    this.selectedMaterialIndex = this.materialIndexFor(this.config.pieces[0]?.material ?? "wood");
    this.snapIndex = new ConstructionSnapIndex(this.config.snap.spatialCellM);
    this.overlapIndex = new ConstructionOverlapIndex(
      this.config.placement.overlapSpatialCellM ?? DEFAULT_OVERLAP_SPATIAL_CELL_M,
    );
    this.root.name = "construction-root";
    this.deps.scene.add(this.root);
    this.pieceStore = new ConstructionPieceStore(
      this.root,
      this.piecesById,
      this.snapIndex,
      this.overlapIndex,
      this.colliderSet,
      createConstructionMaterial,
      { graph: this.supportGraph, supportProfiles: this.config.supportProfiles },
    );
    this.stabilityRuntime = new ConstructionStabilityRuntime(
      this.supportGraph,
      this.piecesById,
      this.config.supportProfiles,
      this.config.stability,
    );

    this.ghostMaterial = trackedMeshBasicMaterial({
      color: GHOST_INVALID_COLOR,
      transparent: true,
      opacity: this.config.ghost.opacity,
      depthWrite: false,
    }, "construction-ghost-base");
    const initialGeometry = this.config.pieces[0]
      ? createPieceGeometry(this.config.pieces[0])
      : new THREE.BoxGeometry(1, 1, 1);
    this.ghostMesh = new THREE.Mesh(initialGeometry, this.ghostMaterial);
    this.ghostPieceId = this.config.pieces[0]?.id ?? null;
    this.ghostMesh.name = "construction-ghost";
    this.ghostMesh.visible = false;
    this.root.add(this.ghostMesh);

    this.ui = createConstructionControllerUi(this.deps.rendererDomElement, {
      isActive: () => this.active,
      onToggleActive: () => this.setActive(!this.active),
      onToggleSnap: () => {
        this.snapEnabled = !this.snapEnabled;
        this.snapSelector.reset();
        console.info(`[construction] snap ${this.snapEnabled ? "on" : "off"}`);
        this.syncUi(true);
      },
      onSnapSuppressedChange: (suppressed) => {
        this.snapSuppressed = suppressed;
        if (suppressed) this.snapSelector.reset();
        this.syncUi(true);
      },
      onCycleSnap: (direction) => {
        this.snapSelector.cycle(direction);
        this.syncUi(true);
      },
      onRotate: () => {
        const stepTurns = Math.max(1, Math.round((this.selectedPiece().rotationStepDegrees ?? 90) / 90));
        this.rotationQuarterTurns = normalizeRotationQuarterTurns(this.rotationQuarterTurns + stepTurns);
        this.snapSelector.reset();
        this.syncUi(true);
      },
      onMaterialStep: (direction) => this.moveMaterialSelection(direction),
      onMaterialSelect: (index) => this.selectMaterial(index),
      onPieceSelect: (index) => this.selectPiece(index),
      onPlace: () => { void this.placeCurrentCandidate(); },
      onDelete: () => this.deleteAimedPiece(),
      onPickPiece: () => this.pickAimedPiece(),
      onUndo: () => { void this.undoLastPlacement(); },
      onPointerUpdate: (event) => this.updatePointerFromEvent(event),
      onPointerLeave: () => { this.pointerInside = false; },
      onInputUnavailable: () => {
        this.lastPlacementMessage = "Build input ignored because the canvas pointer was unavailable.";
        this.syncUi(true);
      },
    });

    const loadResult = loadConstructionPieces({
      storageKey: this.config.placement.storageKey,
      piecesById: this.piecesById,
      placedPieces: this.pieceStore.pieces,
      worldCells: this.deps.worldCells,
      placement: this.config.placement,
      addPiece: (piece: PlacedConstructionPiece) => this.pieceStore.add(piece, false),
    });
    this.nextEntityId = loadResult.nextEntityId;
    this.migrateLoadedConnections();
    this.supportGraph.rebuild(this.pieceStore.pieces);
    this.recomputeStability(this.pieceStore.pieces.map((piece) => piece.id));
    if (loadResult.rewritten) this.savePlacedPieces();
    this.syncUi(true);
    console.info("[construction] CLOD construction ready. B toggle, left-click place, middle-click pick, right-click delete, Ctrl+Z undo, X snap, hold Shift free, Q/E cycle, R rotate.");
  }

  update(): void {
    this.processPendingCollapses();
    if (this.placementInFlight || !this.active || this.config.pieces.length === 0) {
      if (!this.active) this.clearCurrentPreview(false);
      else this.ghostMesh.visible = false;
      this.syncUi();
      this.publishPerformanceCounters();
      return;
    }
    this.performance.measure("previewTotal", () => this.updateActivePreview());
    this.publishPerformanceCounters();
  }

  dispose(): void {
    this.ui.dispose();
    this.snapSelector.reset();
    this.pieceStore.dispose();
    this.ghostMesh.geometry.dispose();
    this.ghostMaterial.dispose();
    this.deps.scene.remove(this.root);
  }

  stats(): ConstructionControllerStats {
    const selected = this.config.pieces[this.selectedIndex] ?? null;
    return {
      active: this.active,
      snapEnabled: this.snapEnabled && !this.snapSuppressed,
      selectedPieceId: selected?.id ?? null,
      placedPieces: this.pieceStore.pieces.length,
      indexedSnapPoints: this.snapIndex.size(),
      indexedOverlapPieces: this.overlapIndex.size(),
      graphNodes: this.supportGraph.nodeCount(),
      graphEdges: this.supportGraph.edgeCount(),
      pendingCollapses: this.stabilityRuntime.pendingCollapseCount(),
      currentValid: this.currentCandidate?.valid ?? false,
      currentReason: this.currentCandidate?.reason ?? null,
      currentStability: this.currentCandidate?.stabilityValue ?? null,
      terrainPreviewValid: this.currentTerrainPreview?.valid ?? null,
      terrainFillVolumeM3: this.currentTerrainPreview?.fillVolumeM3 ?? 0,
      terrainCutVolumeM3: this.currentTerrainPreview?.cutVolumeM3 ?? 0,
      placementInFlight: this.placementInFlight,
      undoDepth: this.undoStack.length,
      stability: this.stabilityRuntime.stats(),
      performance: this.performance.snapshot(),
    };
  }

  setTerrainConformHandler(
    handler: ConstructionTerrainConformHandler | LegacyConstructionTerrainConformHandler | null,
  ): void {
    if (handler === null) {
      this.terrainConformHandler = null;
      return;
    }
    if (typeof handler !== "function") this.terrainConformHandler = handler;
  }

  listPlacedPieces(limit = 256): readonly ConstructionListedPiece[] {
    return listConstructionPlacedPieces(this.pieceStore.pieces, limit);
  }

  breakPiece(input: ConstructionBreakPieceInput): ConstructionBreakPieceResult {
    return breakConstructionPiece({
      placementInFlight: this.placementInFlight,
      pieces: this.pieceStore.pieces,
      forgetUndoRecord: (pieceId) => this.forgetUndoRecord(pieceId),
      removeOne: (pieceId) => this.pieceStore.removeOne(pieceId),
      recomputeStability: (dirtyIds) => this.recomputeStability(dirtyIds),
      clearCurrentPreview: (resetSelector) => this.clearCurrentPreview(resetSelector),
      savePlacedPieces: () => this.savePlacedPieces(),
      setLastPlacementMessage: (message) => {
        this.lastPlacementMessage = message;
      },
      syncUi: (force) => this.syncUi(force),
    }, input);
  }

  async placePieceAt(input: ConstructionPlacePieceAtInput): Promise<ConstructionPlacePieceAtResult> {
    return placeConstructionPieceAt({
      placementInFlight: this.placementInFlight,
      setPlacementInFlight: (value) => {
        this.placementInFlight = value;
      },
      config: this.config,
      piecesById: this.piecesById,
      pieceStore: this.pieceStore,
      overlapIndex: this.overlapIndex,
      worldCells: this.deps.worldCells,
      nextEntityId: this.nextEntityId,
      bumpNextEntityId: () => {
        this.nextEntityId += 1;
      },
      undoStack: this.undoStack,
      editAuthority: this.deps.editAuthority,
      getAuthorityOrigin: this.deps.getAuthorityOrigin,
      getAuthorityCounters: this.deps.getAuthorityCounters,
      constructionReadyAt: this.deps.constructionReadyAt,
      getTerrainRevision: this.deps.getTerrainRevision,
      getInteractionMode: this.deps.getInteractionMode,
      recordEditDenial: this.deps.recordEditDenial,
      resolveTerrainConformHandler: () => this.resolveTerrainConformHandler(),
      applyCommitAuthority: (candidate) => this.applyCommitAuthority(candidate),
      recomputeStability: (dirtyIds) => this.recomputeStability(dirtyIds),
      clearCurrentPreview: (resetSelector) => this.clearCurrentPreview(resetSelector),
      savePlacedPieces: () => this.savePlacedPieces(),
      setLastPlacementMessage: (message) => {
        this.lastPlacementMessage = message;
      },
      syncUi: (force) => this.syncUi(force),
    }, input);
  }

  reevaluateSupportForTerrainEdit(aabb: ConstructionSupportAabb): void {
    if (this.pieceStore.pieces.length === 0) return;
    const result = reevaluateConstructionSupport({
      pieces: this.pieceStore.pieces,
      piecesById: this.piecesById,
      aabb,
      groundSolidAt: (x: number, y: number, z: number) => density(x, y, z) > 0,
    });
    this.supportReevaluations += 1;
    if (!result.changed) return;
    const lost = new Set(result.groundedLost);
    const restored = new Set(result.groundedRestored);
    for (const placed of this.pieceStore.pieces) {
      if (lost.has(placed.id)) placed.grounded = false;
      else if (restored.has(placed.id)) placed.grounded = true;
    }
    this.recomputeStability(result.dirtyIds);
    this.savePlacedPieces();
    this.syncUi(true);
  }

  private updateActivePreview(): void {
    const piece = this.selectedPiece();
    const material = this.selectedMaterial();
    this.syncGhostGeometry(piece);
    const ray = this.readAimRay();
    if (!ray) { this.clearPreviewStats(); return; }
    const terrainHit = this.performance.measure("targeting", () => raycastConstructionTerrain({
      ray,
      worldCells: this.deps.worldCells,
      placement: this.config.placement,
      raycastAuthoritativeTerrain: this.deps.raycastAuthoritativeTerrain
        ?? getActiveTerrainRaycastService()?.raycastAuthoritativeTerrain,
      surfaceHeightAt: surfaceHeight,
      densityAt: density,
    }));

    const snapActive = this.snapEnabled && !this.snapSuppressed;
    const releaseRadius = this.config.snap.radiusM * Math.max(1, this.config.snap.releaseRadiusMultiplier ?? 1.35);
    const snapRayDistanceM = terrainHit
      ? Math.min(this.config.placement.maxRayDistanceM, terrainHit.distanceM + releaseRadius)
      : Math.min(this.config.placement.maxRayDistanceM, this.config.snap.maxRayDistanceM ?? 32);
    const snapCandidates = this.performance.measure("snapQuery", () => snapActive
      ? findConstructionSnapCandidates({
          ray,
          maxDistanceM: snapRayDistanceM,
          piece,
          rotationQuarterTurns: this.rotationQuarterTurns,
          snapIndex: this.snapIndex,
          config: this.config.snap,
        })
      : []);
    const snapStats = this.snapIndex.queryStats();
    this.performance.setSnapQueryStats(
      snapActive ? snapStats.visitedCells : 0,
      snapActive ? snapStats.candidatePoints : 0,
      snapActive && snapStats.traversalTruncated,
    );
    const snap = snapActive
      ? this.snapSelector.select(snapCandidates, this.config.snap.radiusM, this.config.snap.releaseRadiusMultiplier ?? 1.35)
      : null;
    if (!terrainHit && !snap) { this.clearPreviewStats(); return; }
    const rotationQuarterTurns = snap?.rotationQuarterTurns ?? this.rotationQuarterTurns;
    const position = snap?.worldPosition ?? createFreePlacementPosition(piece, terrainHit!, rotationQuarterTurns);
    const connectionIds = snap
      ? findConstructionConnectionIds({
          snapIndex: this.snapIndex,
          piece,
          position,
          rotationQuarterTurns,
          toleranceM: this.config.stability.connectionToleranceM,
          requiredTargetId: snap.target.entityId,
        })
      : [];
    const overlapCandidates = this.overlapIndex.query(piece, position, rotationQuarterTurns);
    const overlapStats = this.overlapIndex.queryStats();
    this.performance.setOverlapQueryStats(overlapStats.visitedCells, overlapStats.candidatePieces);
    let candidate = this.performance.measure("placementValidation", () => this.applyCommitAuthority(createConstructionCandidate({
      piece,
      material,
      position,
      rotationQuarterTurns,
      snapped: snap !== null,
      snap,
      connectionIds,
      terrainHit,
      placedPieces: this.pieceStore.pieces,
      overlapCandidates,
      piecesById: this.piecesById,
      worldCells: this.deps.worldCells,
      config: this.config.placement,
      stabilityConfig: this.config.stability,
      supportProfiles: this.config.supportProfiles,
    })));

    const terrainRequest = createConstructionTerrainConformRequest(candidate, this.config.terrainConform);
    const handler = this.resolveTerrainConformHandler();
    let terrainPreview: ConstructionTerrainConformPreview | null = null;
    if (terrainRequest) {
      this.performance.recordTerrainConformRequest();
      if (!handler) candidate = { ...candidate, valid: false, reason: "terrain conform service unavailable" };
      else {
        terrainPreview = handler.preview(terrainRequest);
        if (!terrainPreview.valid) candidate = { ...candidate, valid: false, reason: terrainPreview.reason };
      }
    }
    this.currentCandidate = candidate;
    this.currentTerrainRequest = terrainRequest;
    this.currentTerrainPreview = terrainPreview;
    this.pendingPlaceCommand = candidate.valid
      ? createEditCommand({
          operation: "construction_place",
          targetPosition: candidate.position,
          targetNormal: candidate.terrainHit?.normal ?? [0, 1, 0],
          sourceTerrainRevision: this.deps.getTerrainRevision?.() ?? getDigEditRevision(),
          actor: "player",
          mode: this.deps.getInteractionMode?.() ?? "playing",
          nowMs: performance.now(),
        })
      : null;
    updateConstructionGhost(this.ghostMesh, this.ghostMaterial, {
      position: candidate.position,
      rotationQuarterTurns: candidate.rotationQuarterTurns,
      valid: candidate.valid,
      stabilityValue: candidate.stabilityValue,
      stabilityMaxSupport: candidate.stabilityMaxSupport,
      stabilityGrounded: candidate.stabilityGrounded,
      collapseThreshold: this.config.stability.collapseThreshold,
    });
    this.syncUi();
  }

  private clearPreviewStats(): void {
    this.performance.setSnapQueryStats(0, 0, false);
    this.performance.setOverlapQueryStats(0, 0);
    this.clearCurrentPreview(true);
  }

  private clearCurrentPreview(resetSelector: boolean): void {
    this.currentCandidate = null;
    this.currentTerrainRequest = null;
    this.currentTerrainPreview = null;
    this.pendingPlaceCommand = null;
    this.ghostMesh.visible = false;
    if (resetSelector) this.snapSelector.reset();
  }

  private syncGhostGeometry(piece: ConstructionPieceDef): void {
    if (this.ghostPieceId === piece.id) return;
    const previous = this.ghostMesh.geometry;
    this.ghostMesh.geometry = createPieceGeometry(piece);
    previous.dispose();
    this.ghostPieceId = piece.id;
  }

  private publishPerformanceCounters(): void {
    const counters = this.deps.getAuthorityCounters?.();
    if (!counters) return;
    const snapshot = this.performance.snapshot();
    const stability = this.stabilityRuntime.stats();
    counters["construction_preview_total_ms"] = snapshot.previewTotal.lastMs;
    counters["construction_preview_total_ms_p95"] = snapshot.previewTotal.p95Ms;
    counters["construction_targeting_ms"] = snapshot.targeting.lastMs;
    counters["construction_snap_query_ms"] = snapshot.snapQuery.lastMs;
    counters["construction_placement_validation_ms"] = snapshot.placementValidation.lastMs;
    counters["construction_snap_visited_cells"] = snapshot.snapVisitedCells;
    counters["construction_snap_candidates"] = snapshot.snapCandidatePoints;
    counters["construction_snap_traversal_truncated"] = snapshot.snapTraversalTruncated ? 1 : 0;
    counters["construction_snap_suppressed"] = this.snapSuppressed ? 1 : 0;
    counters["construction_snap_sticky"] = this.snapSelector.selectedKey() ? 1 : 0;
    counters["construction_overlap_visited_cells"] = snapshot.overlapVisitedCells;
    counters["construction_overlap_candidates"] = snapshot.overlapCandidatePieces;
    counters["construction_placed_meshes"] = this.pieceStore.meshes.length;
    counters["construction_draw_calls_estimate"] = this.pieceStore.meshes.length;
    counters["construction_terrain_conform_requests"] = snapshot.terrainConformRequests;
    counters["construction_terrain_preview_valid"] = this.currentTerrainPreview?.valid === true ? 1 : 0;
    counters["construction_terrain_fill_volume_m3"] = this.currentTerrainPreview?.fillVolumeM3 ?? 0;
    counters["construction_terrain_cut_volume_m3"] = this.currentTerrainPreview?.cutVolumeM3 ?? 0;
    counters["construction_transaction_in_flight"] = this.placementInFlight ? 1 : 0;
    counters["construction_undo_depth"] = this.undoStack.length;
    counters["construction_clod_invalidation_requests"] = snapshot.clodInvalidationRequests;
    counters["construction_colliders_active"] = this.colliderSet.activeCount();
    counters["construction_unsupported_pieces"] = this.pieceStore.unsupportedCount();
    counters["construction_support_reevaluations"] = this.supportReevaluations;
    counters["construction_support_graph_nodes"] = this.supportGraph.nodeCount();
    counters["construction_support_graph_edges"] = this.supportGraph.edgeCount();
    counters["construction_stability_recompute_ms"] = stability.recomputeMs;
    counters["construction_stability_recompute_count"] = stability.recomputeCount;
    counters["construction_stability_islands_last"] = stability.islandsLast;
    counters["construction_stability_largest_island"] = stability.largestIslandLast;
    counters["construction_stability_relaxations_last"] = stability.relaxationsLast;
    counters["construction_stability_cap_hits_total"] = stability.capHitsTotal;
    counters["construction_stability_pending_collapses"] = stability.pendingCollapses;
    counters["construction_stability_collapsed_total"] = stability.collapsedTotal;
    counters["construction_stability_preview_value"] = this.currentCandidate?.stabilityValue ?? 0;
  }

  private updatePointerFromEvent(event: PointerEvent): boolean {
    const rect = this.deps.rendererDomElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    this.pointerNdc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.pointerInside = true;
    return true;
  }

  private setActive(active: boolean): void {
    this.active = active;
    this.pieceStore.setStabilityVisualization(active, this.config.stability.collapseThreshold);
    if (active && document.pointerLockElement === this.deps.rendererDomElement) document.exitPointerLock();
    if (!active) {
      this.clearCurrentPreview(true);
      this.lastPlacementMessage = "";
      this.snapSuppressed = false;
    } else {
      this.lastPlacementMessage = "Left-click place · middle-click pick · right-click delete · Ctrl+Z undo.";
      this.preloadSelectedMaterialWindow();
    }
    console.info(`[construction] building mode ${this.active ? "on" : "off"}`);
    this.syncUi(true);
  }

  private selectedPiece(): ConstructionPieceDef {
    const clampedIndex = Math.max(0, Math.min(this.selectedIndex, this.config.pieces.length - 1));
    return this.config.pieces[clampedIndex]!;
  }

  private selectedMaterial(): ConstructionMaterial {
    return (CONSTRUCTION_MATERIAL_OPTIONS[this.selectedMaterialIndex] ?? CONSTRUCTION_MATERIAL_OPTIONS[0]!).id;
  }

  private materialIndexFor(material: ConstructionMaterial): number {
    const index = CONSTRUCTION_MATERIAL_OPTIONS.findIndex((option) => option.id === material);
    return index >= 0 ? index : 0;
  }

  private preloadSelectedMaterialWindow(): void {
    preloadConstructionMaterialPreviews();
    preloadConstructionMaterialWindow(this.selectedMaterialIndex);
  }

  private moveMaterialSelection(direction: number): void {
    const count = CONSTRUCTION_MATERIAL_OPTIONS.length;
    this.selectedMaterialIndex = ((this.selectedMaterialIndex + direction) % count + count) % count;
    this.preloadSelectedMaterialWindow();
    this.syncUi(true);
  }

  private selectMaterial(index: number): void {
    if (index < 0 || index >= CONSTRUCTION_MATERIAL_OPTIONS.length) return;
    this.selectedMaterialIndex = index;
    this.preloadSelectedMaterialWindow();
    this.syncUi(true);
  }

  private selectPiece(index: number): void {
    if (index < 0 || index >= this.config.pieces.length) return;
    this.selectedIndex = index;
    this.rotationQuarterTurns = 0;
    this.snapSelector.reset();
    this.syncGhostGeometry(this.selectedPiece());
    this.syncUi(true);
  }

  private readAimRay(): THREE.Ray | null {
    return readConstructionAimRay({
      raycaster: this.raycaster,
      camera: this.deps.camera,
      pointerNdc: this.pointerNdc,
      centerNdc: this.centerNdc,
      pointerInside: this.pointerInside,
      rendererDomElement: this.deps.rendererDomElement,
    });
  }

  private applyCommitAuthority(candidate: ConstructionCandidate): ConstructionCandidate {
    return applyConstructionCommitAuthority({
      candidate,
      editAuthority: this.deps.editAuthority,
      getAuthorityOrigin: this.deps.getAuthorityOrigin,
      getAuthorityCounters: this.deps.getAuthorityCounters,
      constructionReadyAt: this.deps.constructionReadyAt,
    });
  }

  private validatePlaceCommand(
    candidate: ConstructionCandidate,
    command: ModedEditCommand | null,
  ): { allowed: true; command: ModedEditCommand } | { allowed: false; reason: string } {
    return validateConstructionPlaceCommand({
      candidate,
      command,
      getTerrainRevision: this.deps.getTerrainRevision,
      getInteractionMode: this.deps.getInteractionMode,
      getAuthorityOrigin: this.deps.getAuthorityOrigin,
      editAuthority: this.deps.editAuthority,
      constructionReadyAt: this.deps.constructionReadyAt,
      recordEditDenial: this.deps.recordEditDenial,
    });
  }

  private resolveTerrainConformHandler(): ConstructionTerrainConformHandler | null {
    return this.terrainConformHandler ?? getActiveConstructionTerrainConformHandler();
  }

  private async placeCurrentCandidate(): Promise<void> {
    if (this.placementInFlight) return;
    // Preserve the immutable ghost command across commit-time re-preview so cross-revision
    // retry validates the original intent against a freshly computed candidate.
    const pendingCommand = this.pendingPlaceCommand;
    if (this.active && this.config.pieces.length > 0) {
      this.performance.measure("previewTotal", () => this.updateActivePreview());
      this.pendingPlaceCommand = pendingCommand;
    }
    const candidate = this.currentCandidate;
    if (!candidate) {
      this.lastPlacementMessage = "No build target. Aim at authoritative near terrain or a snap point.";
      this.syncUi(true);
      return;
    }
    if (!candidate.valid) {
      this.lastPlacementMessage = `Blocked: ${candidate.reason ?? "invalid placement"}`;
      this.syncUi(true);
      return;
    }
    const commandVerdict = this.validatePlaceCommand(candidate, pendingCommand);
    if (!commandVerdict.allowed) {
      this.lastPlacementMessage = `Blocked: ${commandVerdict.reason}`;
      this.syncUi(true);
      return;
    }

    const placed: PlacedConstructionPiece = {
      id: `${ENTITY_ID_PREFIX}${this.nextEntityId}`,
      typeId: candidate.piece.id,
      position: [...candidate.position],
      rotationQuarterTurns: candidate.rotationQuarterTurns,
      material: candidate.material,
      grounded: candidate.stabilityGrounded,
      connectionIds: [...candidate.connectionIds],
      stability: candidate.stabilityValue,
    };
    const terrainRequest = this.currentTerrainRequest;
    this.placementInFlight = true;
    this.ghostMesh.visible = false;
    this.lastPlacementMessage = terrainRequest ? "Committing terrain and construction…" : "Placing construction…";
    this.syncUi(true);
    try {
      const result = await commitConstructionPlacementTransaction({
        piece: placed,
        terrainRequest,
        terrainHandler: this.resolveTerrainConformHandler(),
        addPiece: (piece) => this.pieceStore.add(piece, true),
      });
      if (!result.committed || !result.undoRecord) {
        this.lastPlacementMessage = `Placement failed: ${result.reason ?? "transaction rejected"}`;
        return;
      }
      this.nextEntityId += 1;
      this.undoStack.push(result.undoRecord);
      this.recomputeStability([placed.id, ...(placed.connectionIds ?? [])]);
      this.savePlacedPieces();
      this.lastPlacementMessage = `Placed ${candidate.piece.label} · ${constructionMaterialLabel(candidate.material)}`;
      this.clearCurrentPreview(true);
    } catch (error) {
      this.lastPlacementMessage = `Placement failed: ${error instanceof Error ? error.message : String(error)}`;
      console.error("[construction] placement transaction failed", error);
    } finally {
      this.placementInFlight = false;
      this.syncUi(true);
    }
  }

  private aimedPieceIndex(): number {
    const ray = this.readAimRay();
    if (!ray) return -1;
    return aimedConstructionPieceIndex({
      ray,
      raycaster: this.raycaster,
      camera: this.deps.camera,
      root: this.root,
      meshes: this.pieceStore.meshes,
    });
  }

  private pickAimedPiece(): void {
    const index = this.aimedPieceIndex();
    if (index < 0) { this.lastPlacementMessage = "No construction piece under cursor to pick."; this.syncUi(true); return; }
    const placed = this.pieceStore.pieces[index]!;
    const pieceIndex = this.config.pieces.findIndex((piece) => piece.id === placed.typeId);
    if (pieceIndex >= 0) this.selectPiece(pieceIndex);
    if (placed.material) this.selectedMaterialIndex = this.materialIndexFor(placed.material);
    this.lastPlacementMessage = `Picked ${this.selectedPiece().label}.`;
    this.syncUi(true);
  }

  private deleteAimedPiece(): void {
    if (this.placementInFlight) return;
    const index = this.aimedPieceIndex();
    if (index < 0) { this.lastPlacementMessage = "No construction piece under cursor."; this.syncUi(true); return; }
    const target = this.pieceStore.pieces[index]!;
    const verdict = authorizeConstructionRemoval({
      id: target.id,
      position: [target.position[0], target.position[1], target.position[2]],
    });
    if (!verdict.allowed) {
      this.lastPlacementMessage = `construction removal denied: ${verdict.reason}`;
      console.info(`[construction] ${this.lastPlacementMessage}`);
      this.syncUi(true);
      return;
    }
    const result = this.breakPiece({ pieceId: target.id });
    if (!result.ok) {
      this.lastPlacementMessage = result.reason ?? "Delete target was not tracked.";
      console.info(`[construction] ${this.lastPlacementMessage}`);
      this.syncUi(true);
    }
  }

  private async undoLastPlacement(): Promise<void> {
    if (this.placementInFlight) return;
    while (this.undoStack.length > 0) {
      const latest = this.undoStack[this.undoStack.length - 1]!;
      if (this.pieceStore.pieces.some((piece) => piece.id === latest.piece.id)) break;
      if (latest.terrainReceipt) this.resolveTerrainConformHandler()?.forget?.(latest.terrainReceipt);
      this.undoStack.pop();
    }
    const record = this.undoStack.pop();
    if (!record) { this.lastPlacementMessage = "Nothing to undo."; this.syncUi(true); return; }
    this.placementInFlight = true;
    this.lastPlacementMessage = "Undoing construction and terrain…";
    this.syncUi(true);
    try {
      const result = await undoConstructionPlacementTransaction({
        record,
        terrainHandler: this.resolveTerrainConformHandler(),
        removePiece: (id) => this.pieceStore.removeOne(id).removedCount > 0,
        restorePiece: (piece) => this.pieceStore.add(piece, false),
      });
      if (!result.undone) {
        this.undoStack.push(record);
        this.lastPlacementMessage = `Undo failed: ${result.reason ?? "transaction rejected"}`;
      } else {
        this.recomputeStability(this.pieceStore.pieces.map((piece) => piece.id));
        this.savePlacedPieces();
        this.clearCurrentPreview(true);
        this.lastPlacementMessage = `Undid ${this.piecesById.get(record.piece.typeId)?.label ?? "construction piece"}.`;
      }
    } catch (error) {
      this.undoStack.push(record);
      this.lastPlacementMessage = `Undo failed: ${error instanceof Error ? error.message : String(error)}`;
      console.error("[construction] undo transaction failed", error);
    } finally {
      this.placementInFlight = false;
      this.syncUi(true);
    }
  }

  private forgetUndoRecord(pieceId: string): void {
    const handler = this.resolveTerrainConformHandler();
    for (let index = this.undoStack.length - 1; index >= 0; index -= 1) {
      const record = this.undoStack[index]!;
      if (record.piece.id !== pieceId) continue;
      if (record.terrainReceipt) handler?.forget?.(record.terrainReceipt);
      this.undoStack.splice(index, 1);
    }
  }

  private recomputeStability(dirtyIds: Iterable<string>): void {
    this.stabilityRuntime.markDirtyMany(dirtyIds);
    const result = this.stabilityRuntime.recompute(this.pieceStore.pieces);
    if (result.changedIds.length > 0) this.pieceStore.refreshStabilityVisuals(result.changedIds);
  }

  private processPendingCollapses(): void {
    if (this.stabilityRuntime.pendingCollapseCount() === 0) return;
    const result = this.stabilityRuntime.processPendingCollapses(this.pieceStore.pieces, (id) => {
      this.forgetUndoRecord(id);
      const removal = this.pieceStore.removeOne(id);
      return { removed: removal.removedCount > 0, disconnectedNeighborIds: removal.disconnectedNeighborIds };
    });
    if (result.collapsedIds.length === 0) return;
    this.pieceStore.refreshStabilityVisuals();
    this.clearCurrentPreview(true);
    this.savePlacedPieces();
    this.lastPlacementMessage = result.collapsedIds.length === 1
      ? "Collapsed 1 unstable piece."
      : `Collapsed ${result.collapsedIds.length} unstable pieces.`;
    console.info(`[construction] ${this.lastPlacementMessage}`);
    this.syncUi(true);
  }

  private migrateLoadedConnections(): void {
    for (const placed of this.pieceStore.pieces) {
      placed.connectionIds = [...new Set(placed.connectionIds ?? placed.parentIds ?? [])]
        .filter((id) => id !== placed.id)
        .sort();
      delete placed.parentIds;
    }
  }

  private savePlacedPieces(): void {
    saveConstructionPieces(this.config.placement.storageKey, this.pieceStore.pieces);
  }

  private syncUi(force = false): void {
    const selected = this.selectedPiece();
    this.ui.render({
      active: this.active,
      snapEnabled: this.snapEnabled,
      snapSuppressed: this.snapSuppressed,
      pieces: this.config.pieces,
      selectedIndex: this.selectedIndex,
      selectedPieceId: selected.id,
      rotationQuarterTurns: this.rotationQuarterTurns,
      placedPieces: this.pieceStore.pieces.length,
      indexedSnapPoints: this.snapIndex.size(),
      currentValid: this.currentCandidate?.valid ?? false,
      currentReason: this.currentCandidate?.reason ?? null,
      currentStability: this.currentCandidate?.stabilityValue ?? null,
      currentMaxSupport: this.currentCandidate?.stabilityMaxSupport ?? null,
      currentGrounded: this.currentCandidate?.stabilityGrounded ?? false,
      currentTerrainPreview: this.currentTerrainPreview,
      placementInFlight: this.placementInFlight,
      undoDepth: this.undoStack.length,
      pendingCollapses: this.stabilityRuntime.pendingCollapseCount(),
      materialOptions: CONSTRUCTION_MATERIAL_OPTIONS,
      selectedMaterial: this.selectedMaterial(),
      lastMessage: this.lastPlacementMessage,
    }, force);
  }
}
