import * as THREE from "three";
import { surfaceHeight } from "../terrain/terrain.js";
import { defaultConstructionConfig } from "./config.js";
import { createConstructionCandidate, createFreePlacementPosition, type TerrainHitPoint } from "./placement.js";
import { ConstructionSnapIndex } from "./snap_index.js";
import type { ConstructionCandidate, ConstructionConfig, ConstructionMaterial, ConstructionPieceDef, PlacedConstructionPiece } from "./types.js";

const GHOST_VALID_COLOR = 0x35d46b;
const GHOST_SNAPPED_COLOR = 0x4ea1ff;
const GHOST_INVALID_COLOR = 0xff4f4f;

const MATERIAL_COLORS: Record<ConstructionMaterial, number> = {
  wood: 0x9a673a,
  stone: 0x7f858c,
  metal: 0x777f8a,
  thatch: 0xb59b52,
};

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
  private readonly ghostMaterial: THREE.MeshBasicMaterial;
  private readonly ghostMesh: THREE.Mesh;
  private readonly placedPieces: PlacedConstructionPiece[] = [];
  private readonly disposers: Array<() => void> = [];
  private active = false;
  private snapEnabled = true;
  private selectedIndex = 0;
  private rotationQuarterTurns = 0;
  private pointerInside = false;
  private currentCandidate: ConstructionCandidate | null = null;
  private nextEntityId = 1;

  constructor(private readonly deps: ConstructionControllerDeps) {
    this.config = deps.config ?? defaultConstructionConfig;
    for (const piece of this.config.pieces) this.piecesById.set(piece.id, piece);
    this.snapIndex = new ConstructionSnapIndex(this.config.snap.spatialCellM);
    this.root.name = "construction-root";
    this.deps.scene.add(this.root);

    this.ghostMaterial = new THREE.MeshBasicMaterial({
      color: GHOST_INVALID_COLOR,
      transparent: true,
      opacity: this.config.ghost.opacity,
      depthWrite: false,
    });
    this.ghostMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.ghostMaterial);
    this.ghostMesh.name = "construction-ghost";
    this.ghostMesh.visible = false;
    this.root.add(this.ghostMesh);

    this.installInput();
    this.loadSavedPieces();
    console.info("[construction] CLOD construction ready. B toggle, X snap, R rotate, 1-9 select, right-click place.");
  }

  update(): void {
    if (!this.active || this.config.pieces.length === 0) {
      this.currentCandidate = null;
      this.ghostMesh.visible = false;
      return;
    }

    const piece = this.selectedPiece();
    const ray = this.readAimRay();
    const terrainHit = ray ? this.raycastTerrain(ray) : null;
    if (!terrainHit) {
      this.currentCandidate = null;
      this.ghostMesh.visible = false;
      return;
    }

    const snap = this.snapEnabled
      ? this.snapIndex.findBestSnap(terrainHit.point, piece, this.rotationQuarterTurns, this.config.snap)
      : null;
    const position = snap?.worldPosition ?? createFreePlacementPosition(piece, terrainHit);
    const candidate = createConstructionCandidate({
      piece,
      position,
      rotationQuarterTurns: this.rotationQuarterTurns,
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
  }

  dispose(): void {
    for (const dispose of this.disposers) dispose();
    this.ghostMesh.geometry.dispose();
    this.ghostMaterial.dispose();
    this.deps.scene.remove(this.root);
  }

  stats(): ConstructionControllerStats {
    return {
      active: this.active,
      snapEnabled: this.snapEnabled,
      selectedPieceId: this.selectedPiece()?.id ?? null,
      placedPieces: this.placedPieces.length,
      indexedSnapPoints: this.snapIndex.size(),
      currentValid: this.currentCandidate?.valid ?? false,
      currentReason: this.currentCandidate?.reason ?? null,
    };
  }

  private installInput(): void {
    const onPointerMove = (event: PointerEvent) => {
      const rect = this.deps.rendererDomElement.getBoundingClientRect();
      this.pointerNdc.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      this.pointerInside = true;
    };
    const onPointerLeave = () => {
      this.pointerInside = false;
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!this.active || event.button !== 2) return;
      event.preventDefault();
      this.placeCurrentCandidate();
    };
    const onContextMenu = (event: MouseEvent) => {
      if (!this.active) return;
      event.preventDefault();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (this.isTextInputEvent(event)) return;
      if (event.code === "KeyB") {
        this.active = !this.active;
        console.info(`[construction] building mode ${this.active ? "on" : "off"}`);
        return;
      }
      if (!this.active) return;
      if (event.code === "KeyX") {
        this.snapEnabled = !this.snapEnabled;
        console.info(`[construction] snap ${this.snapEnabled ? "on" : "off"}`);
        return;
      }
      if (event.code === "KeyR") {
        this.rotationQuarterTurns = (this.rotationQuarterTurns + 1) % 4;
        return;
      }
      if (event.code.startsWith("Digit")) {
        const index = Number(event.code.slice(5)) - 1;
        if (Number.isInteger(index) && index >= 0 && index < this.config.pieces.length) {
          this.selectedIndex = index;
        }
      }
    };

    this.deps.rendererDomElement.addEventListener("pointermove", onPointerMove);
    this.deps.rendererDomElement.addEventListener("pointerleave", onPointerLeave);
    this.deps.rendererDomElement.addEventListener("pointerdown", onPointerDown);
    this.deps.rendererDomElement.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("keydown", onKeyDown);
    this.disposers.push(
      () => this.deps.rendererDomElement.removeEventListener("pointermove", onPointerMove),
      () => this.deps.rendererDomElement.removeEventListener("pointerleave", onPointerLeave),
      () => this.deps.rendererDomElement.removeEventListener("pointerdown", onPointerDown),
      () => this.deps.rendererDomElement.removeEventListener("contextmenu", onContextMenu),
      () => window.removeEventListener("keydown", onKeyDown),
    );
  }

  private isTextInputEvent(event: KeyboardEvent): boolean {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
  }

  private selectedPiece(): ConstructionPieceDef {
    return this.config.pieces[Math.min(this.selectedIndex, this.config.pieces.length - 1)]!;
  }

  private readAimRay(): THREE.Ray | null {
    if (document.pointerLockElement === this.deps.rendererDomElement) {
      this.raycaster.setFromCamera({ x: 0, y: 0 }, this.deps.camera);
      return this.raycaster.ray.clone();
    }
    if (!this.pointerInside) return null;
    this.raycaster.setFromCamera(this.pointerNdc, this.deps.camera);
    return this.raycaster.ray.clone();
  }

  private raycastTerrain(ray: THREE.Ray): TerrainHitPoint | null {
    const maxDistance = this.config.placement.maxRayDistanceM;
    const step = this.config.placement.terrainStepM;
    const scratch = new THREE.Vector3();
    let previousT = 0;
    ray.at(previousT, scratch);
    let previousSigned = scratch.y - surfaceHeight(scratch.x, scratch.z);

    for (let t = step; t <= maxDistance; t += step) {
      ray.at(t, scratch);
      const inWorld = scratch.x >= 0 && scratch.x <= this.deps.worldCells && scratch.z >= 0 && scratch.z <= this.deps.worldCells;
      const signed = inWorld ? scratch.y - surfaceHeight(scratch.x, scratch.z) : Number.POSITIVE_INFINITY;
      if (inWorld && previousSigned >= 0 && signed <= 0) {
        let lo = previousT;
        let hi = t;
        for (let i = 0; i < 12; i += 1) {
          const mid = (lo + hi) * 0.5;
          ray.at(mid, scratch);
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

  private updateGhost(candidate: ConstructionCandidate): void {
    this.ghostMesh.visible = true;
    this.ghostMesh.position.set(candidate.position[0], candidate.position[1], candidate.position[2]);
    this.ghostMesh.rotation.set(0, candidate.rotationQuarterTurns * Math.PI * 0.5, 0);
    this.ghostMesh.scale.set(candidate.piece.dimensionsM[0], candidate.piece.dimensionsM[1], candidate.piece.dimensionsM[2]);
    this.ghostMaterial.color.setHex(candidate.valid ? candidate.snapped ? GHOST_SNAPPED_COLOR : GHOST_VALID_COLOR : GHOST_INVALID_COLOR);
  }

  private placeCurrentCandidate(): void {
    const candidate = this.currentCandidate;
    if (!candidate?.valid) return;
    const placed: PlacedConstructionPiece = {
      id: `piece-${this.nextEntityId++}`,
      typeId: candidate.piece.id,
      position: candidate.position,
      rotationQuarterTurns: candidate.rotationQuarterTurns,
    };
    this.addPlacedPiece(placed, true);
    this.savePlacedPieces();
  }

  private addPlacedPiece(placed: PlacedConstructionPiece, logPlacement: boolean): void {
    const piece = this.piecesById.get(placed.typeId);
    if (!piece) return;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(piece.dimensionsM[0], piece.dimensionsM[1], piece.dimensionsM[2]),
      new THREE.MeshStandardMaterial({ color: MATERIAL_COLORS[piece.material], roughness: 0.78 }),
    );
    mesh.name = `construction-${placed.typeId}`;
    mesh.position.set(placed.position[0], placed.position[1], placed.position[2]);
    mesh.rotation.set(0, placed.rotationQuarterTurns * Math.PI * 0.5, 0);
    this.root.add(mesh);
    this.placedPieces.push(placed);
    this.snapIndex.addPiece(piece, placed.id, placed.position, placed.rotationQuarterTurns);
    if (logPlacement) console.info(`[construction] placed ${piece.label} at ${placed.position.map((v) => v.toFixed(2)).join(", ")}`);
  }

  private loadSavedPieces(): void {
    try {
      const raw = localStorage.getItem(this.config.placement.storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      for (const entry of parsed) {
        if (!this.isPlacedPiece(entry)) continue;
        this.nextEntityId = Math.max(this.nextEntityId, Number(entry.id.replace("piece-", "")) + 1 || this.nextEntityId);
        this.addPlacedPiece(entry, false);
      }
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

  private isPlacedPiece(value: unknown): value is PlacedConstructionPiece {
    if (!value || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    return typeof record.id === "string"
      && typeof record.typeId === "string"
      && Array.isArray(record.position)
      && record.position.length === 3
      && record.position.every((n) => Number.isFinite(Number(n)))
      && Number.isInteger(Number(record.rotationQuarterTurns));
  }
}
