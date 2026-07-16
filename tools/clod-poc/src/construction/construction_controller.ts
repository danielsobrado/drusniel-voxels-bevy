import * as THREE from "three";
import { surfaceHeight } from "../terrain/terrain.js";
import { defaultConstructionConfig } from "./config.js";
import { CONSTRUCTION_MATERIAL_OPTIONS, constructionMaterialLabel } from "./materials.js";
import { preloadConstructionMaterialPreviews, preloadConstructionMaterialWindow } from "./material_preloader.js";
import { createConstructionCandidate, createFreePlacementPosition } from "./placement.js";
import { ConstructionSnapIndex } from "./snap_index.js";
import { ENTITY_ID_PREFIX, GHOST_INVALID_COLOR, normalizeRotationQuarterTurns } from "./construction_controller_support.js";
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
import { findBestConstructionSnap, updateConstructionGhost } from "./construction_preview.js";
import { ConstructionPieceStore } from "./construction_piece_store.js";
import { loadConstructionPieces, saveConstructionPieces } from "./construction_persistence.js";
import { createConstructionTerrainConformRequest } from "./construction_terrain_conform.js";
import { createConstructionControllerUi, type ConstructionControllerUi } from "./construction_controller_ui.js";

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
}

export interface ConstructionControllerStats {
  active: boolean;
  snapEnabled: boolean;
  selectedPieceId: string | null;
  placedPieces: number;
  indexedSnapPoints: number;
  indexedOverlapPieces: number;
  currentValid: boolean;
  currentReason: string | null;
  performance: ConstructionPerformanceSnapshot;
}

export interface ConstructionController {
  update(): void;
  dispose(): void;
  stats(): ConstructionControllerStats;
  setTerrainConformHandler(handler: ((request: ConstructionTerrainConformRequest) => void) | null): void;
}

export function createConstructionController(deps: ConstructionControllerDeps): ConstructionController {
  return new ConstructionControllerImpl(deps);
}

class ConstructionControllerImpl implements ConstructionController {
  private readonly config: ConstructionConfig;
  private readonly piecesById = new Map<string, ConstructionPieceDef>();
  private readonly root = new THREE.Group();
  private readonly snapIndex: ConstructionSnapIndex;
  private readonly overlapIndex: ConstructionOverlapIndex;
  private readonly pieceStore: ConstructionPieceStore;
  private readonly performance = new ConstructionPerformanceTracker();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2(0, 0);
  private readonly centerNdc = new THREE.Vector2(0, 0);
  private readonly ghostMaterial: THREE.MeshBasicMaterial;
  private readonly ghostMesh: THREE.Mesh;
  private readonly ui: ConstructionControllerUi;
  private active = false;
  private snapEnabled = true;
  private selectedIndex = 0;
  private selectedMaterialIndex = 0;
  private rotationQuarterTurns = 0;
  private pointerInside = false;
  private currentCandidate: ConstructionCandidate | null = null;
  private nextEntityId = 1;
  private lastPlacementMessage = "";
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
    this.pieceStore = new ConstructionPieceStore(this.root, this.piecesById, this.snapIndex, this.overlapIndex);

    this.ghostMaterial = trackedMeshBasicMaterial({
      color: GHOST_INVALID_COLOR,
      transparent: true,
      opacity: this.config.ghost.opacity,
      depthWrite: false,
    }, "construction-ghost-base");
    this.ghostMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.ghostMaterial);
    this.ghostMesh.name = "construction-ghost";
    this.ghostMesh.visible = false;
    this.root.add(this.ghostMesh);

    this.ui = createConstructionControllerUi(this.deps.rendererDomElement, {
      isActive: () => this.active,
      onToggleActive: () => this.setActive(!this.active),
      onToggleSnap: () => {
        this.snapEnabled = !this.snapEnabled;
        console.info(`[construction] snap ${this.snapEnabled ? "on" : "off"}`);
        this.syncUi(true);
      },
      onRotate: () => {
        this.rotationQuarterTurns = normalizeRotationQuarterTurns(this.rotationQuarterTurns + 1);
        this.syncUi(true);
      },
      onMaterialStep: (direction) => this.moveMaterialSelection(direction),
      onMaterialSelect: (index) => this.selectMaterial(index),
      onPieceSelect: (index) => this.selectPiece(index),
      onPlace: () => this.placeCurrentCandidate(),
      onDelete: () => this.deleteAimedPiece(),
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
      addPiece: (piece) => this.pieceStore.add(piece, false),
    });
    this.nextEntityId = loadResult.nextEntityId;
    this.syncUi(true);
    console.info("[construction] CLOD construction ready. B toggle, left-click place, right-click delete, X snap, R rotate, 1-9 select.");
  }

  update(): void {
    if (!this.active || this.config.pieces.length === 0) {
      this.currentCandidate = null;
      this.ghostMesh.visible = false;
      this.syncUi();
      return;
    }
    this.performance.measure("previewTotal", () => this.updateActivePreview());
    this.publishPerformanceCounters();
  }

  dispose(): void {
    this.ui.dispose();
    this.pieceStore.dispose();
    this.ghostMesh.geometry.dispose();
    this.ghostMaterial.dispose();
    this.deps.scene.remove(this.root);
  }

  stats(): ConstructionControllerStats {
    const selected = this.config.pieces[this.selectedIndex] ?? null;
    return {
      active: this.active,
      snapEnabled: this.snapEnabled,
      selectedPieceId: selected?.id ?? null,
      placedPieces: this.pieceStore.pieces.length,
      indexedSnapPoints: this.snapIndex.size(),
      indexedOverlapPieces: this.overlapIndex.size(),
      currentValid: this.currentCandidate?.valid ?? false,
      currentReason: this.currentCandidate?.reason ?? null,
      performance: this.performance.snapshot(),
    };
  }

  setTerrainConformHandler(handler: ((request: ConstructionTerrainConformRequest) => void) | null): void {
    this.terrainConformHandler = handler;
  }

  private updateActivePreview(): void {
    const piece = this.selectedPiece();
    const ray = this.readAimRay();
    if (!ray) {
      this.performance.setSnapQueryStats(0, 0, false);
      this.performance.setOverlapQueryStats(0, 0);
      this.currentCandidate = null;
      this.ghostMesh.visible = false;
      this.syncUi();
      return;
    }
    const terrainHit = this.performance.measure("targeting", () => raycastConstructionTerrain({
      ray,
      worldCells: this.deps.worldCells,
      placement: this.config.placement,
      surfaceHeightAt: surfaceHeight,
    }));
    if (!terrainHit) {
      this.performance.setSnapQueryStats(0, 0, false);
      this.performance.setOverlapQueryStats(0, 0);
      this.currentCandidate = null;
      this.ghostMesh.visible = false;
      this.syncUi();
      return;
    }

    const snap = this.performance.measure("snapQuery", () => this.snapEnabled
      ? findBestConstructionSnap({
          ray,
          terrainHit,
          piece,
          rotationQuarterTurns: this.rotationQuarterTurns,
          snapIndex: this.snapIndex,
          config: this.config.snap,
        })
      : null);
    const snapStats = this.snapIndex.queryStats();
    this.performance.setSnapQueryStats(
      this.snapEnabled ? snapStats.visitedCells : 0,
      this.snapEnabled ? snapStats.candidatePoints : 0,
      this.snapEnabled && snapStats.traversalTruncated,
    );
    const rotationQuarterTurns = snap?.rotationQuarterTurns ?? this.rotationQuarterTurns;
    const position = snap?.worldPosition ?? createFreePlacementPosition(piece, terrainHit);
    const overlapCandidates = this.overlapIndex.query(piece, position, rotationQuarterTurns);
    const overlapStats = this.overlapIndex.queryStats();
    this.performance.setOverlapQueryStats(overlapStats.visitedCells, overlapStats.candidatePieces);
    const candidate = this.performance.measure("placementValidation", () => this.applyCommitAuthority(createConstructionCandidate({
      piece,
      position,
      rotationQuarterTurns,
      snapped: snap !== null,
      snap,
      terrainHit,
      placedPieces: this.pieceStore.pieces,
      overlapCandidates,
      piecesById: this.piecesById,
      worldCells: this.deps.worldCells,
      config: this.config.placement,
    })));

    this.currentCandidate = candidate;
    updateConstructionGhost(this.ghostMesh, this.ghostMaterial, {
      position: candidate.position,
      rotationQuarterTurns: candidate.rotationQuarterTurns,
      dimensionsM: candidate.piece.dimensionsM,
      valid: candidate.valid,
      snapped: candidate.snapped,
    });
    this.syncUi();
  }

  private publishPerformanceCounters(): void {
    const counters = this.deps.getAuthorityCounters?.();
    if (!counters) return;
    const snapshot = this.performance.snapshot();
    counters["construction_preview_total_ms"] = snapshot.previewTotal.lastMs;
    counters["construction_preview_total_ms_p95"] = snapshot.previewTotal.p95Ms;
    counters["construction_targeting_ms"] = snapshot.targeting.lastMs;
    counters["construction_snap_query_ms"] = snapshot.snapQuery.lastMs;
    counters["construction_placement_validation_ms"] = snapshot.placementValidation.lastMs;
    counters["construction_snap_visited_cells"] = snapshot.snapVisitedCells;
    counters["construction_snap_candidates"] = snapshot.snapCandidatePoints;
    counters["construction_snap_traversal_truncated"] = snapshot.snapTraversalTruncated ? 1 : 0;
    counters["construction_overlap_visited_cells"] = snapshot.overlapVisitedCells;
    counters["construction_overlap_candidates"] = snapshot.overlapCandidatePieces;
    counters["construction_placed_meshes"] = this.pieceStore.meshes.length;
    counters["construction_draw_calls_estimate"] = this.pieceStore.meshes.length;
    counters["construction_terrain_conform_requests"] = snapshot.terrainConformRequests;
    counters["construction_clod_invalidation_requests"] = snapshot.clodInvalidationRequests;
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
    if (active && document.pointerLockElement === this.deps.rendererDomElement) document.exitPointerLock();
    if (!active) {
      this.currentCandidate = null;
      this.ghostMesh.visible = false;
      this.lastPlacementMessage = "";
    } else {
      this.lastPlacementMessage = "Left-click to place. Right-click deletes aimed construction.";
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
      this.lastPlacementMessage = "No build target. Aim at terrain or a snap point.";
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
    const material = this.selectedMaterial();
    const placed: PlacedConstructionPiece = {
      id: `${ENTITY_ID_PREFIX}${this.nextEntityId++}`,
      typeId: candidate.piece.id,
      position: [candidate.position[0], candidate.position[1], candidate.position[2]],
      rotationQuarterTurns: candidate.rotationQuarterTurns,
      material,
      grounded: candidate.supportState === "grounded",
      parentIds: candidate.supportParentIds ?? [],
    };
    if (!this.pieceStore.add(placed, true)) {
      this.lastPlacementMessage = "Placement failed while adding mesh.";
      console.warn(`[construction] ${this.lastPlacementMessage}`);
      this.syncUi(true);
      return;
    }
    this.requestTerrainConform(candidate);
    this.lastPlacementMessage = `Placed ${candidate.piece.label} · ${constructionMaterialLabel(material)}`;
    this.currentCandidate = null;
    this.ghostMesh.visible = false;
    this.savePlacedPieces();
    this.syncUi(true);
  }

  private deleteAimedPiece(): void {
    const ray = this.readAimRay();
    if (!ray) {
      this.lastPlacementMessage = "No delete target. Aim at an existing construction piece.";
      this.syncUi(true);
      return;
    }
    this.deps.camera.updateMatrixWorld(true);
    this.root.updateMatrixWorld(true);
    this.raycaster.ray.copy(ray);
    const hit = this.raycaster.intersectObjects(this.pieceStore.meshes, false)[0];
    if (!hit) {
      this.lastPlacementMessage = "No construction piece under cursor.";
      this.syncUi(true);
      return;
    }
    const index = this.pieceStore.meshes.indexOf(hit.object as THREE.Mesh);
    if (index < 0) {
      this.lastPlacementMessage = "Delete target was not tracked.";
      console.warn(`[construction] ${this.lastPlacementMessage}`);
      this.syncUi(true);
      return;
    }
    const removedIds = this.pieceStore.collectDependentIds(this.pieceStore.pieces[index]!.id);
    const removedCount = this.pieceStore.removeByIds(removedIds);
    this.currentCandidate = null;
    this.ghostMesh.visible = false;
    this.savePlacedPieces();
    this.lastPlacementMessage = removedCount === 1 ? "Deleted 1 piece." : `Deleted ${removedCount} connected pieces.`;
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

  private savePlacedPieces(): void {
    saveConstructionPieces(this.config.placement.storageKey, this.pieceStore.pieces);
  }

  private syncUi(force = false): void {
    const selected = this.selectedPiece();
    this.ui.render({
      active: this.active,
      snapEnabled: this.snapEnabled,
      pieces: this.config.pieces,
      selectedIndex: this.selectedIndex,
      selectedPieceId: selected.id,
      rotationQuarterTurns: this.rotationQuarterTurns,
      placedPieces: this.pieceStore.pieces.length,
      indexedSnapPoints: this.snapIndex.size(),
      currentValid: this.currentCandidate?.valid ?? false,
      currentReason: this.currentCandidate?.reason ?? null,
      materialOptions: CONSTRUCTION_MATERIAL_OPTIONS,
      selectedMaterial: this.selectedMaterial(),
      lastMessage: this.lastPlacementMessage,
    }, force);
  }
}
