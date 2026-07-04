import * as THREE from "three";
import { surfaceHeight } from "../terrain/terrain.js";
import { defaultConstructionConfig } from "./config.js";
import { asConstructionMaterial, CONSTRUCTION_MATERIAL_OPTIONS, constructionMaterialLabel, createConstructionMaterial } from "./materials.js";
import { renderConstructionMenuHtml } from "./construction_menu_render.js";
import { preloadConstructionMaterialPreviews, preloadConstructionMaterialWindow } from "./material_preloader.js";
import { createConstructionCandidate, createFreePlacementPosition, type TerrainHitPoint } from "./placement.js";
import { validateStrictPersistedConstructionPlacement } from "./persisted_placement.js";
import { ConstructionSnapIndex } from "./snap_index.js";
import {
  BUILD_POINTER_OPTIONS,
  ENTITY_ID_PREFIX,
  GHOST_INVALID_COLOR,
  GHOST_SNAPPED_COLOR,
  GHOST_VALID_COLOR,
  MENU_ID,
  RAYCAST_REFINE_STEPS,
  ROTATION_QUARTER_COUNT,
  asFiniteVec3,
  createPieceGeometry,
  disposeMesh,
  hasExplicitSupportMetadata,
  normalizeRotationQuarterTurns,
  readStringArray,
} from "./construction_controller_support.js";
import type {
  ConstructionCandidate,
  ConstructionConfig,
  ConstructionMaterial,
  ConstructionPieceDef,
  ConstructionSnapResult,
  ConstructionTerrainConformRequest,
  PlacedConstructionPiece,
} from "./types.js";
import { trackedMeshBasicMaterial } from "../rendering/material_churn/tracked_material_factory.js";

export interface ConstructionControllerDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  rendererDomElement: HTMLElement;
  worldCells: number;
  config?: ConstructionConfig;
}

export interface ConstructionControllerStats {
  active: boolean;
  snapEnabled: boolean;
  selectedPieceId: string | null;
  placedPieces: number;
  indexedSnapPoints: number;
  currentValid: boolean;
  currentReason: string | null;
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
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2(0, 0);
  private readonly centerNdc = new THREE.Vector2(0, 0);
  private readonly ghostMaterial: THREE.MeshBasicMaterial;
  private readonly ghostMesh: THREE.Mesh;
  private readonly placedPieces: PlacedConstructionPiece[] = [];
  private readonly placedMeshes: THREE.Mesh[] = [];
  private readonly disposers: Array<() => void> = [];
  private readonly menu: HTMLElement;
  private active = false;
  private snapEnabled = true;
  private selectedIndex = 0;
  private selectedMaterialIndex = 0;
  private rotationQuarterTurns = 0;
  private pointerInside = false;
  private currentCandidate: ConstructionCandidate | null = null;
  private nextEntityId = 1;
  private lastUiStateKey = "";
  private lastPlacementMessage = "";
  private terrainConformHandler: ((request: ConstructionTerrainConformRequest) => void) | null = null;
  private dragOffset: { x: number; y: number } | null = null;

  constructor(private readonly deps: ConstructionControllerDeps) {
    this.config = deps.config ?? defaultConstructionConfig;
    for (const piece of this.config.pieces) this.piecesById.set(piece.id, piece);
    this.selectedMaterialIndex = this.materialIndexFor(this.config.pieces[0]?.material ?? "wood");
    this.snapIndex = new ConstructionSnapIndex(this.config.snap.spatialCellM);
    this.root.name = "construction-root";
    this.deps.scene.add(this.root);

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

    this.menu = this.createBuildMenu();
    this.installInput();
    this.loadSavedPieces();
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

    const piece = this.selectedPiece();
    const ray = this.readAimRay();
    if (!ray) {
      this.currentCandidate = null;
      this.ghostMesh.visible = false;
      this.syncUi();
      return;
    }
    const terrainHit = this.raycastTerrain(ray);
    if (!terrainHit) {
      this.currentCandidate = null;
      this.ghostMesh.visible = false;
      this.syncUi();
      return;
    }

    const snap = this.snapEnabled ? this.findBestSnapForPreview(ray, terrainHit, piece) : null;
    const rotationQuarterTurns = snap?.rotationQuarterTurns ?? this.rotationQuarterTurns;
    const position = snap?.worldPosition ?? createFreePlacementPosition(piece, terrainHit);
    const candidate = createConstructionCandidate({
      piece,
      position,
      rotationQuarterTurns,
      snapped: snap !== null,
      snap,
      terrainHit,
      placedPieces: this.placedPieces,
      piecesById: this.piecesById,
      worldCells: this.deps.worldCells,
      config: this.config.placement,
    });

    this.currentCandidate = candidate;
    this.updateGhost(candidate);
    this.syncUi();
  }

  dispose(): void {
    this.dragOffset = null;
    for (const dispose of this.disposers) dispose();
    for (const mesh of this.placedMeshes) disposeMesh(mesh);
    this.placedMeshes.length = 0;
    this.ghostMesh.geometry.dispose();
    this.ghostMaterial.dispose();
    this.menu.remove();
    this.deps.scene.remove(this.root);
  }

  stats(): ConstructionControllerStats {
    const selected = this.config.pieces[this.selectedIndex] ?? null;
    return {
      active: this.active,
      snapEnabled: this.snapEnabled,
      selectedPieceId: selected?.id ?? null,
      placedPieces: this.placedPieces.length,
      indexedSnapPoints: this.snapIndex.size(),
      currentValid: this.currentCandidate?.valid ?? false,
      currentReason: this.currentCandidate?.reason ?? null,
    };
  }

  setTerrainConformHandler(handler: ((request: ConstructionTerrainConformRequest) => void) | null): void {
    this.terrainConformHandler = handler;
  }

  private installInput(): void {
    const onPointerMove = (event: PointerEvent) => {
      this.updatePointerFromEvent(event);
    };
    const onPointerLeave = () => {
      this.pointerInside = false;
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!this.active) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!this.updatePointerFromEvent(event)) {
        this.lastPlacementMessage = "Build input ignored because the canvas pointer was unavailable.";
        this.syncUi(true);
        return;
      }
      if (event.button === 0) {
        this.placeCurrentCandidate();
        return;
      }
      if (event.button === 2) this.deleteAimedPiece();
    };
    const onContextMenu = (event: MouseEvent) => {
      if (!this.active) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (this.isTextInputEvent(event)) return;
      if (event.code === "KeyB") {
        event.preventDefault();
        this.setActive(!this.active);
        return;
      }
      if (!this.active) return;
      if (event.code === "KeyX") {
        event.preventDefault();
        this.snapEnabled = !this.snapEnabled;
        console.info(`[construction] snap ${this.snapEnabled ? "on" : "off"}`);
        this.syncUi(true);
        return;
      }
      if (event.code === "KeyR") {
        event.preventDefault();
        this.rotationQuarterTurns = normalizeRotationQuarterTurns(this.rotationQuarterTurns + 1);
        this.syncUi(true);
        return;
      }
      if (event.code === "ArrowLeft") {
        event.preventDefault();
        this.moveMaterialSelection(-1);
        return;
      }
      if (event.code === "ArrowRight") {
        event.preventDefault();
        this.moveMaterialSelection(1);
        return;
      }
      if (event.code.startsWith("Digit")) {
        const index = Number(event.code.slice(5)) - 1;
        if (Number.isInteger(index) && index >= 0 && index < this.config.pieces.length) {
          event.preventDefault();
          this.selectedIndex = index;
          this.syncUi(true);
        }
      }
    };

    this.deps.rendererDomElement.addEventListener("pointermove", onPointerMove);
    this.deps.rendererDomElement.addEventListener("pointerleave", onPointerLeave);
    this.deps.rendererDomElement.addEventListener("pointerdown", onPointerDown, BUILD_POINTER_OPTIONS);
    this.deps.rendererDomElement.addEventListener("contextmenu", onContextMenu, BUILD_POINTER_OPTIONS);
    window.addEventListener("keydown", onKeyDown);
    this.disposers.push(
      () => this.deps.rendererDomElement.removeEventListener("pointermove", onPointerMove),
      () => this.deps.rendererDomElement.removeEventListener("pointerleave", onPointerLeave),
      () => this.deps.rendererDomElement.removeEventListener("pointerdown", onPointerDown, BUILD_POINTER_OPTIONS),
      () => this.deps.rendererDomElement.removeEventListener("contextmenu", onContextMenu, BUILD_POINTER_OPTIONS),
      () => window.removeEventListener("keydown", onKeyDown),
    );
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

  private isTextInputEvent(event: KeyboardEvent): boolean {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
  }

  private setActive(active: boolean): void {
    this.active = active;
    if (active && document.pointerLockElement === this.deps.rendererDomElement) {
      document.exitPointerLock();
    }
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

  private readAimRay(): THREE.Ray | null {
    if (document.pointerLockElement === this.deps.rendererDomElement) {
      this.raycaster.setFromCamera(this.centerNdc, this.deps.camera);
      return this.raycaster.ray.clone();
    }
    if (!this.pointerInside) return null;
    this.raycaster.setFromCamera(this.pointerNdc, this.deps.camera);
    return this.raycaster.ray.clone();
  }

  private inPlacementWorld(x: number, z: number): boolean {
    return this.config.placement.unboundedWorld === true
      || (x >= 0 && x <= this.deps.worldCells && z >= 0 && z <= this.deps.worldCells);
  }

  private raycastTerrain(ray: THREE.Ray): TerrainHitPoint | null {
    const maxDistance = this.config.placement.maxRayDistanceM;
    const step = this.config.placement.terrainStepM;
    const scratch = new THREE.Vector3();
    let previousT: number | null = null;
    let previousSigned = 0;

    for (let t = 0; t <= maxDistance; t += step) {
      ray.at(t, scratch);
      if (!this.inPlacementWorld(scratch.x, scratch.z)) {
        previousT = null;
        continue;
      }

      const signed = scratch.y - surfaceHeight(scratch.x, scratch.z);
      if (previousT !== null && previousSigned >= 0 && signed <= 0) {
        let lo = previousT;
        let hi = t;
        for (let i = 0; i < RAYCAST_REFINE_STEPS; i += 1) {
          const mid = (lo + hi) * 0.5;
          ray.at(mid, scratch);
          if (!this.inPlacementWorld(scratch.x, scratch.z)) {
            lo = mid;
            continue;
          }
          const midSigned = scratch.y - surfaceHeight(scratch.x, scratch.z);
          if (midSigned > 0) lo = mid;
          else hi = mid;
        }
        ray.at(hi, scratch);
        return { point: [scratch.x, scratch.y, scratch.z], distanceM: hi };
      }
      previousT = t;
      previousSigned = signed;
    }
    return null;
  }

  private findBestSnapForPreview(ray: THREE.Ray, terrainHit: TerrainHitPoint, piece: ConstructionPieceDef): ConstructionSnapResult | null {
    let best: ConstructionSnapResult | null = null;
    for (let offset = 0; offset < ROTATION_QUARTER_COUNT; offset += 1) {
      const rotation = normalizeRotationQuarterTurns(this.rotationQuarterTurns + offset);
      const snap = this.snapIndex.findBestSnapNearRay(
        [ray.origin.x, ray.origin.y, ray.origin.z],
        [ray.direction.x, ray.direction.y, ray.direction.z],
        terrainHit.distanceM + this.config.snap.radiusM,
        piece,
        rotation,
        this.config.snap,
      );
      if (!snap || (best && snap.score <= best.score)) continue;
      best = snap;
    }
    return best;
  }

  private updateGhost(candidate: ConstructionCandidate): void {
    this.ghostMesh.visible = true;
    this.ghostMesh.position.set(candidate.position[0], candidate.position[1], candidate.position[2]);
    this.ghostMesh.rotation.set(0, candidate.rotationQuarterTurns * Math.PI * 0.5, 0);
    this.ghostMesh.scale.set(candidate.piece.dimensionsM[0], candidate.piece.dimensionsM[1], candidate.piece.dimensionsM[2]);
    this.ghostMaterial.color.setHex(candidate.valid ? candidate.snapped ? GHOST_SNAPPED_COLOR : GHOST_VALID_COLOR : GHOST_INVALID_COLOR);
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
    if (!this.addPlacedPiece(placed, true)) {
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
    const hit = this.raycaster.intersectObjects(this.placedMeshes, false)[0];
    if (!hit) {
      this.lastPlacementMessage = "No construction piece under cursor.";
      this.syncUi(true);
      return;
    }
    const index = this.placedMeshes.indexOf(hit.object as THREE.Mesh);
    if (index < 0) {
      this.lastPlacementMessage = "Delete target was not tracked.";
      console.warn(`[construction] ${this.lastPlacementMessage}`);
      this.syncUi(true);
      return;
    }
    const removedIds = this.collectDependentPieceIds(this.placedPieces[index]!.id);
    const removedCount = this.removePlacedPiecesById(removedIds);
    this.currentCandidate = null;
    this.ghostMesh.visible = false;
    this.savePlacedPieces();
    this.lastPlacementMessage = removedCount === 1 ? "Deleted 1 piece." : `Deleted ${removedCount} connected pieces.`;
    console.info(`[construction] ${this.lastPlacementMessage}`);
    this.syncUi(true);
  }

  private collectDependentPieceIds(rootId: string): Set<string> {
    const result = new Set<string>([rootId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const placed of this.placedPieces) {
        if (result.has(placed.id)) continue;
        if ((placed.parentIds ?? []).some((parentId) => result.has(parentId))) {
          result.add(placed.id);
          changed = true;
        }
      }
    }
    return result;
  }

  private removePlacedPiecesById(ids: ReadonlySet<string>): number {
    let removed = 0;
    for (let index = this.placedPieces.length - 1; index >= 0; index -= 1) {
      const placed = this.placedPieces[index]!;
      if (!ids.has(placed.id)) continue;
      const mesh = this.placedMeshes[index];
      if (mesh) {
        this.root.remove(mesh);
        disposeMesh(mesh);
      }
      this.snapIndex.removeEntity(placed.id);
      this.placedPieces.splice(index, 1);
      this.placedMeshes.splice(index, 1);
      removed += 1;
    }
    return removed;
  }

  private addPlacedPiece(placed: PlacedConstructionPiece, logPlacement: boolean): boolean {
    const piece = this.piecesById.get(placed.typeId);
    if (!piece) return false;
    const normalized = this.normalizePlacedPiece(placed);
    if (!normalized) return false;
    const material = normalized.material ?? piece.material;
    const mesh = new THREE.Mesh(
      createPieceGeometry(piece),
      createConstructionMaterial(material),
    );
    mesh.name = `construction-${normalized.typeId}`;
    mesh.position.set(normalized.position[0], normalized.position[1], normalized.position[2]);
    mesh.rotation.set(0, normalized.rotationQuarterTurns * Math.PI * 0.5, 0);
    this.root.add(mesh);
    mesh.updateMatrixWorld(true);
    this.placedMeshes.push(mesh);
    this.placedPieces.push(normalized);
    this.snapIndex.addPiece(piece, normalized.id, normalized.position, normalized.rotationQuarterTurns);
    if (logPlacement) {
      console.info(`[construction] placed ${piece.label} (${constructionMaterialLabel(material)}) at ${normalized.position.map((v) => v.toFixed(2)).join(", ")}`);
    }
    return true;
  }

  private requestTerrainConform(candidate: ConstructionCandidate): void {
    const conform = this.config.terrainConform;
    if (!conform.enabled || !this.terrainConformHandler) return;
    if (!conform.foundationCategories.includes(candidate.piece.category)) return;
    this.terrainConformHandler({
      pieceId: candidate.piece.id,
      position: candidate.position,
      dimensionsM: candidate.piece.dimensionsM,
      rotationQuarterTurns: candidate.rotationQuarterTurns,
      materialSlot: conform.materialSlot,
      padMarginM: conform.padMarginM,
      fillDepthM: conform.fillDepthM,
      trimHeightM: conform.trimHeightM,
      falloffM: conform.falloffM,
    });
  }

  private loadSavedPieces(): void {
    try {
      const raw = localStorage.getItem(this.config.placement.storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;

      let rewriteStorage = false;
      const pending: PlacedConstructionPiece[] = [];
      const seenIds = new Set<string>();
      for (const entry of parsed) {
        const placed = this.normalizePlacedPiece(entry);
        const piece = placed ? this.piecesById.get(placed.typeId) : null;
        if (!placed || !piece) {
          rewriteStorage = true;
          continue;
        }
        if (seenIds.has(placed.id)) {
          console.warn(`[construction] skipped duplicate saved piece ${placed.id}`);
          rewriteStorage = true;
          continue;
        }
        seenIds.add(placed.id);
        if (!hasExplicitSupportMetadata(placed)) {
          if (!piece.canGround) {
            console.warn(`[construction] skipped legacy saved piece ${placed.id}: invalid support`);
            rewriteStorage = true;
            continue;
          }
          placed.grounded = true;
          placed.parentIds = [];
          rewriteStorage = true;
        }
        const suffix = Number(placed.id.startsWith(ENTITY_ID_PREFIX) ? placed.id.slice(ENTITY_ID_PREFIX.length) : NaN);
        if (Number.isInteger(suffix) && suffix >= this.nextEntityId) this.nextEntityId = suffix + 1;
        pending.push(placed);
      }

      let madeProgress = true;
      while (pending.length > 0 && madeProgress) {
        madeProgress = false;
        for (let index = pending.length - 1; index >= 0; index -= 1) {
          const placed = pending[index]!;
          const piece = this.piecesById.get(placed.typeId);
          if (!piece) {
            pending.splice(index, 1);
            rewriteStorage = true;
            continue;
          }
          const validation = validateStrictPersistedConstructionPlacement({
            piece,
            placed,
            placedPieces: this.placedPieces,
            piecesById: this.piecesById,
            worldCells: this.deps.worldCells,
            config: this.config.placement,
          });
          if (validation.valid) {
            pending.splice(index, 1);
            madeProgress = this.addPlacedPiece(placed, false) || madeProgress;
            continue;
          }
          if (validation.reason !== "unsupported") {
            console.warn(`[construction] skipped invalid saved piece ${placed.id}: ${validation.reason ?? "invalid"}`);
            pending.splice(index, 1);
            rewriteStorage = true;
          }
        }
      }

      for (const placed of pending) {
        console.warn(`[construction] skipped invalid saved piece ${placed.id}: unsupported`);
      }
      if (pending.length > 0) rewriteStorage = true;
      if (rewriteStorage || this.placedPieces.length !== parsed.length) this.savePlacedPieces();
    } catch (error) {
      console.warn("[construction] failed to load saved pieces", error);
    }
  }

  private savePlacedPieces(): void {
    try {
      localStorage.setItem(this.config.placement.storageKey, JSON.stringify(this.placedPieces));
    } catch (error) {
      console.warn("[construction] failed to save placed pieces", error);
    }
  }

  private normalizePlacedPiece(value: unknown): PlacedConstructionPiece | null {
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    const position = asFiniteVec3(record.position);
    const rotation = Number(record.rotationQuarterTurns);
    if (typeof record.id !== "string" || typeof record.typeId !== "string" || !position || !Number.isFinite(rotation)) return null;

    const normalized: PlacedConstructionPiece = {
      id: record.id,
      typeId: record.typeId,
      position,
      rotationQuarterTurns: normalizeRotationQuarterTurns(rotation),
    };
    if (typeof record.material === "string") {
      const material = asConstructionMaterial(record.material);
      if (material) normalized.material = material;
    }
    if (typeof record.grounded === "boolean") normalized.grounded = record.grounded;
    const parentIds = readStringArray(record.parentIds);
    if (parentIds !== undefined) normalized.parentIds = parentIds;
    return normalized;
  }

  private createBuildMenu(): HTMLElement {
    const menu = document.createElement("section");
    menu.id = MENU_ID;
    menu.setAttribute("aria-label", "Build menu");
    Object.assign(menu.style, {
      position: "fixed",
      left: "50%",
      bottom: "76px",
      transform: "translateX(-50%)",
      zIndex: "13",
      display: "none",
      width: "min(520px, calc(100vw - 16px))",
      padding: "10px",
      boxSizing: "border-box",
      color: "#eef3f8",
      background: "linear-gradient(180deg, rgba(18, 23, 30, 0.94), rgba(8, 11, 15, 0.88))",
      border: "1px solid rgba(123, 167, 214, 0.36)",
      borderRadius: "10px",
      boxShadow: "0 12px 34px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.08)",
      font: "11px/1.3 system-ui, -apple-system, Segoe UI, sans-serif",
      backdropFilter: "blur(5px)",
      userSelect: "none",
      touchAction: "none",
    });
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target) return;

      const materialStep = target.closest<HTMLButtonElement>("button[data-material-step]");
      if (materialStep) {
        const step = Number(materialStep.dataset.materialStep);
        if (Number.isFinite(step)) this.moveMaterialSelection(step);
        return;
      }

      const materialButton = target.closest<HTMLButtonElement>("button[data-material-index]");
      if (materialButton) {
        const index = Number(materialButton.dataset.materialIndex);
        if (Number.isInteger(index) && index >= 0 && index < CONSTRUCTION_MATERIAL_OPTIONS.length) {
          this.selectedMaterialIndex = index;
          this.preloadSelectedMaterialWindow();
          this.syncUi(true);
        }
        return;
      }

      const pieceButton = target.closest<HTMLButtonElement>("button[data-piece-index]");
      if (!pieceButton) return;
      const index = Number(pieceButton.dataset.pieceIndex);
      if (!Number.isInteger(index) || index < 0 || index >= this.config.pieces.length) return;
      this.selectedIndex = index;
      this.syncUi(true);
    };
    const onPointerDown = (event: PointerEvent) => {
      const handle = event.target instanceof HTMLElement
        ? event.target.closest<HTMLElement>("[data-drag-handle]")
        : null;
      if (!handle) return;
      event.preventDefault();
      const rect = menu.getBoundingClientRect();
      this.dragOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      menu.style.left = `${rect.left}px`;
      menu.style.top = `${rect.top}px`;
      menu.style.transform = "none";
      menu.style.bottom = "auto";
      menu.style.right = "auto";
      menu.style.cursor = "grabbing";
      const onMove = (e: PointerEvent) => {
        if (!this.dragOffset) return;
        menu.style.left = `${e.clientX - this.dragOffset.x}px`;
        menu.style.top = `${e.clientY - this.dragOffset.y}px`;
      };
      const onUp = () => {
        this.dragOffset = null;
        menu.style.cursor = "";
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };
    menu.addEventListener("click", onClick);
    menu.addEventListener("pointerdown", onPointerDown);
    this.disposers.push(
      () => menu.removeEventListener("click", onClick),
      () => menu.removeEventListener("pointerdown", onPointerDown),
    );
    document.body.appendChild(menu);
    return menu;
  }

  private syncUi(force = false): void {
    const selected = this.selectedPiece();
    const selectedMaterial = this.selectedMaterial();
    const stateKey = JSON.stringify({
      active: this.active,
      snapEnabled: this.snapEnabled,
      selectedIndex: this.selectedIndex,
      selectedMaterial,
      rotationQuarterTurns: this.rotationQuarterTurns,
      currentValid: this.currentCandidate?.valid ?? false,
      currentReason: this.currentCandidate?.reason ?? null,
      placedPieces: this.placedPieces.length,
      snapPoints: this.snapIndex.size(),
      lastPlacementMessage: this.lastPlacementMessage,
    });
    if (!force && stateKey === this.lastUiStateKey) return;
    this.lastUiStateKey = stateKey;
    this.menu.innerHTML = renderConstructionMenuHtml({
      active: this.active,
      snapEnabled: this.snapEnabled,
      pieces: this.config.pieces,
      selectedPieceId: selected.id,
      rotationQuarterTurns: this.rotationQuarterTurns,
      placedPieces: this.placedPieces.length,
      indexedSnapPoints: this.snapIndex.size(),
      currentValid: this.currentCandidate?.valid ?? false,
      currentReason: this.currentCandidate?.reason ?? null,
      materialOptions: CONSTRUCTION_MATERIAL_OPTIONS,
      selectedMaterial,
      lastMessage: this.lastPlacementMessage,
    });
    this.menu.style.display = this.active ? "block" : "none";
  }
}
