import * as THREE from "three";
import { surfaceHeight } from "../terrain/terrain.js";
import { defaultConstructionConfig } from "./config.js";
import { createConstructionCandidate, createFreePlacementPosition, type TerrainHitPoint } from "./placement.js";
import { ConstructionSnapIndex } from "./snap_index.js";
import type {
  ConstructionCandidate,
  ConstructionConfig,
  ConstructionMaterial,
  ConstructionPieceDef,
  ConstructionTerrainConformRequest,
  PlacedConstructionPiece,
} from "./types.js";

const GHOST_VALID_COLOR = 0x35d46b;
const GHOST_SNAPPED_COLOR = 0x4ea1ff;
const GHOST_INVALID_COLOR = 0xff4f4f;
const MENU_ID = "construction-build-menu";

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
  private readonly disposers: Array<() => void> = [];
  private readonly menu: HTMLElement;
  private active = false;
  private snapEnabled = true;
  private selectedIndex = 0;
  private rotationQuarterTurns = 0;
  private pointerInside = false;
  private currentCandidate: ConstructionCandidate | null = null;
  private nextEntityId = 1;
  private terrainConformHandler: ((request: ConstructionTerrainConformRequest) => void) | null = null;

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

    this.menu = this.createBuildMenu();
    this.installInput();
    this.loadSavedPieces();
    this.syncUi();

    if (this.config.enabled && this.config.pieces.length > 0) {
      console.info("[construction] CLOD construction ready. B toggle, X snap, R rotate, 1-9 select, right-click place.");
    } else {
      console.info("[construction] CLOD construction disabled or has no configured pieces.");
    }
  }

  update(): void {
    if (!this.config.enabled || !this.active || this.config.pieces.length === 0) {
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
    const snap = this.snapEnabled
      ? this.snapIndex.findBestSnapOnRay(
        this.vectorToTuple(ray.origin),
        this.vectorToTuple(ray.direction),
        terrainHit?.distanceM ?? this.config.placement.maxRayDistanceM,
        piece,
        this.rotationQuarterTurns,
        this.config.snap,
      )
      : null;

    if (!terrainHit && !snap) {
      this.currentCandidate = null;
      this.ghostMesh.visible = false;
      this.syncUi();
      return;
    }

    const position = snap?.worldPosition ?? createFreePlacementPosition(piece, terrainHit!);
    const rotationQuarterTurns = snap?.rotationQuarterTurns ?? this.rotationQuarterTurns;
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
    for (const dispose of this.disposers) dispose();
    this.disposeRootMeshes();
    this.menu.remove();
    this.deps.scene.remove(this.root);
  }

  stats(): ConstructionControllerStats {
    const selected = this.config.pieces[this.selectedIndex] ?? null;
    return {
      active: this.config.enabled && this.active,
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
        this.setActive(!this.active);
        return;
      }
      if (!this.active) return;
      if (event.code === "KeyX") {
        this.snapEnabled = !this.snapEnabled;
        console.info(`[construction] snap ${this.snapEnabled ? "on" : "off"}`);
        this.syncUi();
        return;
      }
      if (event.code === "KeyR") {
        this.rotationQuarterTurns = (this.rotationQuarterTurns + 1) % 4;
        this.syncUi();
        return;
      }
      if (event.code.startsWith("Digit")) {
        const index = Number(event.code.slice(5)) - 1;
        if (Number.isInteger(index) && index >= 0 && index < this.config.pieces.length) {
          this.selectedIndex = index;
          this.syncUi();
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

  private setActive(active: boolean): void {
    this.active = this.config.enabled && this.config.pieces.length > 0 && active;
    console.info(`[construction] building mode ${this.active ? "on" : "off"}`);
    this.syncUi();
  }

  private selectedPiece(): ConstructionPieceDef {
    const clampedIndex = Math.max(0, Math.min(this.selectedIndex, this.config.pieces.length - 1));
    return this.config.pieces[clampedIndex]!;
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
    this.requestTerrainConform(candidate);
    this.savePlacedPieces();
    this.syncUi();
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
      for (const entry of parsed) {
        const placed = this.parsePlacedPiece(entry);
        if (!placed) continue;
        const idNumber = Number(placed.id.replace("piece-", ""));
        if (Number.isInteger(idNumber)) this.nextEntityId = Math.max(this.nextEntityId, idNumber + 1);
        this.addPlacedPiece(placed, false);
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

  private parsePlacedPiece(value: unknown): PlacedConstructionPiece | null {
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : null;
    const typeId = typeof record.typeId === "string" ? record.typeId : null;
    if (!id || !typeId || !this.piecesById.has(typeId)) return null;
    if (!Array.isArray(record.position) || record.position.length !== 3) return null;
    const position = record.position.map(Number);
    const rotationQuarterTurns = Number(record.rotationQuarterTurns);
    if (!position.every(Number.isFinite) || !Number.isInteger(rotationQuarterTurns)) return null;
    return {
      id,
      typeId,
      position: [position[0], position[1], position[2]],
      rotationQuarterTurns: ((rotationQuarterTurns % 4) + 4) % 4,
    };
  }

  private createBuildMenu(): HTMLElement {
    const menu = document.createElement("section");
    menu.id = MENU_ID;
    menu.setAttribute("aria-label", "Build menu");
    Object.assign(menu.style, {
      position: "absolute",
      right: "8px",
      bottom: "8px",
      zIndex: "13",
      display: "none",
      width: "min(360px, calc(100vw - 16px))",
      padding: "8px",
      boxSizing: "border-box",
      color: "#eef3f8",
      background: "rgba(12, 15, 19, 0.78)",
      border: "1px solid rgba(255, 255, 255, 0.14)",
      borderRadius: "5px",
      font: "11px/1.3 system-ui, -apple-system, Segoe UI, sans-serif",
      backdropFilter: "blur(3px)",
      userSelect: "none",
    });
    document.body.appendChild(menu);
    return menu;
  }

  private syncUi(): void {
    this.menu.style.display = this.config.enabled && this.active ? "grid" : "none";
    if (!this.config.enabled || !this.active) return;
    const selected = this.config.pieces[this.selectedIndex] ?? null;
    const candidate = this.currentCandidate;
    const status = candidate
      ? candidate.valid ? candidate.snapped ? "snapped" : "valid" : candidate.reason ?? "invalid"
      : "aim at terrain";
    const displayedRotation = candidate?.rotationQuarterTurns ?? this.rotationQuarterTurns;
    const pieceButtons = this.config.pieces.map((piece, index) => {
      const selectedAttr = index === this.selectedIndex ? "true" : "false";
      return `<button type="button" data-piece-index="${index}" aria-pressed="${selectedAttr}">${index + 1}. ${piece.label}</button>`;
    }).join("");
    this.menu.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">
        <strong>Build</strong>
        <span style="color:#9fb0c0;">B close · R rotate · X snap</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;margin-bottom:6px;">${pieceButtons}</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;color:#cdd8e3;">
        <span>Selected: ${selected?.label ?? "none"}</span>
        <span>Snap: ${this.snapEnabled ? "on" : "off"}</span>
        <span>Rot: ${displayedRotation * 90}°</span>
        <span>State: ${status}</span>
      </div>
    `;
    for (const button of this.menu.querySelectorAll<HTMLButtonElement>("button[data-piece-index]")) {
      Object.assign(button.style, {
        padding: "6px 7px",
        border: "1px solid #46515e",
        borderRadius: "3px",
        color: "#dce5ee",
        background: button.getAttribute("aria-pressed") === "true" ? "#245781" : "#20262d",
        cursor: "pointer",
        font: "inherit",
      });
      button.addEventListener("click", () => {
        const index = Number(button.dataset.pieceIndex);
        if (!Number.isInteger(index) || index < 0 || index >= this.config.pieces.length) return;
        this.selectedIndex = index;
        this.syncUi();
      });
    }
  }

  private vectorToTuple(value: THREE.Vector3): [number, number, number] {
    return [value.x, value.y, value.z];
  }

  private disposeRootMeshes(): void {
    const disposedMaterials = new Set<THREE.Material>();
    this.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (disposedMaterials.has(material)) continue;
        material.dispose();
        disposedMaterials.add(material);
      }
    });
  }
}
