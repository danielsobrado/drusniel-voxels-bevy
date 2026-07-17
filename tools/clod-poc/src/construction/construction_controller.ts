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
  ConstructionTerrainConformRequest,
  PlacedConstructionPiece,
} from "./types.js";
import { trackedMeshBasicMaterial } from "../rendering/material_churn/tracked_material_factory.js";
import {
  canCommitBuild,
  publishPlayerEditAuthorityDecision,
  type PlayerEditAuthorityConfig,
  type PlayerEditAuthorityPoint,
} from "../player/player_edit_authority.js";
import { ConstructionOverlapIndex } from "./overlap_index.js";
import { ConstructionPerformanceTracker, type ConstructionPerformanceSnapshot } from "./construction_timing.js";
import { raycastConstructionTerrain } from "./targeting.js";
import { findConstructionSnapCandidates, updateConstructionGhost } from "./construction_preview.js";
import { ConstructionSnapSelector } from "./construction_snap_selector.js";
import type { AuthoritativeConstructionTerrainHit } from "./targeting.js";
import { getActiveTerrainRaycastService } from "../player/terrain_raycast_registry.js";
import { ConstructionColliderSet } from "./construction_collider.js";
import { ConstructionPieceStore } from "./construction_piece_store.js";
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
  stability: ConstructionStabilityRuntimeStats;
  performance: ConstructionPerformanceSnapshot;
}

export interface ConstructionController {
  update(): void;
  dispose(): void;
  stats(): ConstructionControllerStats;
  setTerrainConformHandler(handler: ((request: ConstructionTerrainConformRequest) => void) | null): void;
  readonly colliderSet: ConstructionColliderSet;
  reevaluateSupportForTerrainEdit(aabb: ConstructionSupportAabb): void;
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
  private active = false;
  private snapEnabled = true;
  private snapSuppressed = false;
  private selectedIndex = 0;
  private selectedMaterialIndex = 0;
  private rotationQuarterTurns = 0;
  private pointerInside = false;
  private currentCandidate: ConstructionCandidate | null = null;
  private nextEntityId = 1;
  private lastPlacementMessage = "";
  private supportReevaluations = 0;
  private ghostPieceId: string | null = null;
  private terrainConformHandler: ((request: ConstructionTerrainConformRequest) => void) | null = null;

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
      onPlace: () => this.placeCurrentCandidate(),
      onDelete: () => this.deleteAimedPiece(),
      onPickPiece: () => this.pickAimedPiece(),
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
    console.info("[construction] CLOD construction ready. B toggle, left-click place, middle-click pick, right-click delete, X snap, hold Shift free, Q/E cycle, R rotate.");
  }

  update(): void {
    this.processPendingCollapses();
    if (!this.active || this.config.pieces.length === 0) {
      this.currentCandidate = null;
      this.ghostMesh.visible = false;
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
      stability: this.stabilityRuntime.stats(),
      performance: this.performance.snapshot(),
    };
  }

  setTerrainConformHandler(handler: ((request: ConstructionTerrainConformRequest) => void) | null): void {
    this.terrainConformHandler = handler;
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
    if (!ray) {
      this.clearPreviewStats();
      return;
    }
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
      ? this.snapSelector.select(
          snapCandidates,
          this.config.snap.radiusM,
          this.config.snap.releaseRadiusMultiplier ?? 1.35,
        )
      : null;
    if (!terrainHit && !snap) {
      this.clearPreviewStats();
      return;
    }
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
    const candidate = this.performance.measure("placementValidation", () => this.applyCommitAuthority(createConstructionCandidate({
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

    this.currentCandidate = candidate;
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
    this.currentCandidate = null;
    this.ghostMesh.visible = false;
    this.snapSelector.reset();
    this.syncUi();
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
      this.currentCandidate = null;
      this.ghostMesh.visible = false;
      this.lastPlacementMessage = "";
      this.snapSuppressed = false;
      this.snapSelector.reset();
    } else {
      this.lastPlacementMessage = "Left-click place · middle-click pick · right-click delete.";
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
    if (document.pointerLockElement === this.deps.rendererDomElement) {
      this.raycaster.setFromCamera(this.centerNdc, this.deps.camera);
      return this.raycaster.ray.clone();
    }
    if (!this.pointerInside) return null;
    this.raycaster.setFromCamera(this.pointerNdc, this.deps.camera);
    return this.raycaster.ray.clone();
  }

  private applyCommitAuthority(candidate: ConstructionCandidate): ConstructionCandidate {
    const editAuthority = this.deps.editAuthority;
    if (!editAuthority) return candidate;
    const decision = canCommitBuild(editAuthority, this.deps.getAuthorityOrigin?.() ?? null, candidate.position);
    publishPlayerEditAuthorityDecision(this.deps.getAuthorityCounters?.() ?? null, decision);
    return decision.allowed ? candidate : { ...candidate, valid: false, reason: decision.reason };
  }

  private placeCurrentCandidate(): void {
    if (!this.currentCandidate) this.update();
    const candidate = this.currentCandidate;
    if (!candidate) {
      this.lastPlacementMessage = "No build target. Aim at authoritative near terrain or a snap point.";
      console.warn(`[construction] ${this.lastPlacementMessage}`);
      this.syncUi(true);
      return;
    }
    if (!candidate.valid) {
      this.lastPlacementMessage = `Blocked: ${candidate.reason ?? "invalid placement"}`;
      console.warn(`[construction] ${this.lastPlacementMessage}`);
      this.syncUi(true);
      return;
    }
    const placed: PlacedConstructionPiece = {
      id: `${ENTITY_ID_PREFIX}${this.nextEntityId++}`,
      typeId: candidate.piece.id,
      position: [candidate.position[0], candidate.position[1], candidate.position[2]],
      rotationQuarterTurns: candidate.rotationQuarterTurns,
      material: candidate.material,
      grounded: candidate.stabilityGrounded,
      connectionIds: candidate.connectionIds,
      stability: candidate.stabilityValue,
    };
    if (!this.pieceStore.add(placed, true)) {
      this.lastPlacementMessage = "Placement failed while adding mesh.";
      console.warn(`[construction] ${this.lastPlacementMessage}`);
      this.syncUi(true);
      return;
    }
    this.recomputeStability([placed.id, ...placed.connectionIds!]);
    this.requestTerrainConform(candidate);
    this.lastPlacementMessage = `Placed ${candidate.piece.label} · ${constructionMaterialLabel(candidate.material)}`;
    this.currentCandidate = null;
    this.ghostMesh.visible = false;
    this.snapSelector.reset();
    this.savePlacedPieces();
    this.syncUi(true);
  }

  private aimedPieceIndex(): number {
    const ray = this.readAimRay();
    if (!ray) return -1;
    this.deps.camera.updateMatrixWorld(true);
    this.root.updateMatrixWorld(true);
    this.raycaster.ray.copy(ray);
    const hit = this.raycaster.intersectObjects(this.pieceStore.meshes, false)[0];
    return hit ? this.pieceStore.meshes.indexOf(hit.object as THREE.Mesh) : -1;
  }

  private pickAimedPiece(): void {
    const index = this.aimedPieceIndex();
    if (index < 0) {
      this.lastPlacementMessage = "No construction piece under cursor to pick.";
      this.syncUi(true);
      return;
    }
    const placed = this.pieceStore.pieces[index]!;
    const pieceIndex = this.config.pieces.findIndex((piece) => piece.id === placed.typeId);
    if (pieceIndex >= 0) this.selectPiece(pieceIndex);
    if (placed.material) this.selectedMaterialIndex = this.materialIndexFor(placed.material);
    this.lastPlacementMessage = `Picked ${this.selectedPiece().label}.`;
    this.syncUi(true);
  }

  private deleteAimedPiece(): void {
    const index = this.aimedPieceIndex();
    if (index < 0) {
      this.lastPlacementMessage = "No construction piece under cursor.";
      this.syncUi(true);
      return;
    }
    const targetId = this.pieceStore.pieces[index]!.id;
    const removal = this.pieceStore.removeOne(targetId);
    this.recomputeStability(removal.disconnectedNeighborIds);
    this.currentCandidate = null;
    this.ghostMesh.visible = false;
    this.snapSelector.reset();
    this.savePlacedPieces();
    this.lastPlacementMessage = removal.removedCount === 1
      ? "Deleted 1 piece. Stability recomputed."
      : "Delete target was not tracked.";
    console.info(`[construction] ${this.lastPlacementMessage}`);
    this.syncUi(true);
  }

  private requestTerrainConform(candidate: ConstructionCandidate): void {
    if (!this.terrainConformHandler) return;
    const request = createConstructionTerrainConformRequest(candidate, this.config.terrainConform);
    if (!request) return;
    this.performance.recordTerrainConformRequest();
    this.terrainConformHandler(request);
  }

  private recomputeStability(dirtyIds: Iterable<string>): void {
    this.stabilityRuntime.markDirtyMany(dirtyIds);
    const result = this.stabilityRuntime.recompute(this.pieceStore.pieces);
    if (result.changedIds.length > 0) this.pieceStore.refreshStabilityVisuals(result.changedIds);
  }

  private processPendingCollapses(): void {
    if (this.stabilityRuntime.pendingCollapseCount() === 0) return;
    const result = this.stabilityRuntime.processPendingCollapses(this.pieceStore.pieces, (id) => {
      const removal = this.pieceStore.removeOne(id);
      return {
        removed: removal.removedCount > 0,
        disconnectedNeighborIds: removal.disconnectedNeighborIds,
      };
    });
    if (result.collapsedIds.length === 0) return;
    this.pieceStore.refreshStabilityVisuals();
    this.currentCandidate = null;
    this.ghostMesh.visible = false;
    this.snapSelector.reset();
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
      pendingCollapses: this.stabilityRuntime.pendingCollapseCount(),
      materialOptions: CONSTRUCTION_MATERIAL_OPTIONS,
      selectedMaterial: this.selectedMaterial(),
      lastMessage: this.lastPlacementMessage,
    }, force);
  }
}
