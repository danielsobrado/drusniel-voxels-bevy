import * as THREE from "three";
import { surfaceHeight } from "../terrain/terrain.js";
import { defaultConstructionConfig } from "./config.js";
import { createConstructionCandidate, createFreePlacementPosition, validateConstructionPlacement, type TerrainHitPoint } from "./placement.js";
import { ConstructionSnapIndex } from "./snap_index.js";
import type {
  ConstructionCandidate,
  ConstructionConfig,
  ConstructionMaterial,
  ConstructionPieceDef,
  ConstructionSnapResult,
  ConstructionTerrainConformRequest,
  PlacedConstructionPiece,
} from "./types.js";

const GHOST_VALID_COLOR = 0x35d46b;
const GHOST_SNAPPED_COLOR = 0x4ea1ff;
const GHOST_INVALID_COLOR = 0xff4f4f;
const MENU_ID = "construction-build-menu";
const ROTATION_QUARTER_COUNT = 4;
const RAYCAST_REFINE_STEPS = 12;
const ENTITY_ID_PREFIX = "piece-";

const MATERIAL_COLORS: Record<ConstructionMaterial, number> = {
  wood: 0x9a673a,
  stone: 0x7f858c,
  metal: 0x777f8a,
  thatch: 0xb59b52,
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeRotationQuarterTurns(value: number): number {
  const turns = Math.trunc(value);
  return ((turns % ROTATION_QUARTER_COUNT) + ROTATION_QUARTER_COUNT) % ROTATION_QUARTER_COUNT;
}

function asFiniteVec3(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const parsed = value.map(Number);
  return parsed.every(Number.isFinite) ? [parsed[0], parsed[1], parsed[2]] : null;
}

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
  private rotationQuarterTurns = 0;
  private pointerInside = false;
  private currentCandidate: ConstructionCandidate | null = null;
  private nextEntityId = 1;
  private lastUiStateKey = "";
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
    this.syncUi(true);
    console.info("[construction] CLOD construction ready. B toggle, X snap, R rotate, 1-9 select, right-click place.");
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

    const snap = this.snapEnabled
      ? this.findBestSnapForPreview(ray, terrainHit, piece)
      : null;
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
    for (const dispose of this.disposers) dispose();
    for (const mesh of this.placedMeshes) {
      mesh.geometry.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) {
        for (const entry of material) entry.dispose();
      } else {
        material.dispose();
      }
    }
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
      const rect = this.deps.rendererDomElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
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
    this.active = active;
    if (!active) {
      this.currentCandidate = null;
      this.ghostMesh.visible = false;
    }
    console.info(`[construction] building mode ${this.active ? "on" : "off"}`);
    this.syncUi(true);
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
    let previousT: number | null = null;
    let previousSigned = 0;

    for (let t = 0; t <= maxDistance; t += step) {
      ray.at(t, scratch);
      const inWorld = scratch.x >= 0 && scratch.x <= this.deps.worldCells && scratch.z >= 0 && scratch.z <= this.deps.worldCells;
      if (!inWorld) {
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
          const midInWorld = scratch.x >= 0 && scratch.x <= this.deps.worldCells && scratch.z >= 0 && scratch.z <= this.deps.worldCells;
          if (!midInWorld) {
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

  private findBestSnapForPreview(
    ray: THREE.Ray,
    terrainHit: TerrainHitPoint,
    piece: ConstructionPieceDef,
  ): ConstructionSnapResult | null {
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
    const candidate = this.currentCandidate;
    if (!candidate?.valid) return;
    const placed: PlacedConstructionPiece = {
      id: `${ENTITY_ID_PREFIX}${this.nextEntityId++}`,
      typeId: candidate.piece.id,
      position: [candidate.position[0], candidate.position[1], candidate.position[2]],
      rotationQuarterTurns: candidate.rotationQuarterTurns,
    };
    this.addPlacedPiece(placed, true);
    this.requestTerrainConform(candidate);
    this.currentCandidate = null;
    this.ghostMesh.visible = false;
    this.savePlacedPieces();
    this.syncUi(true);
  }

  private addPlacedPiece(placed: PlacedConstructionPiece, logPlacement: boolean): void {
    const piece = this.piecesById.get(placed.typeId);
    if (!piece) return;
    const normalized = this.normalizePlacedPiece(placed);
    if (!normalized) return;
    const validation = validateConstructionPlacement({
      piece,
      position: normalized.position,
      rotationQuarterTurns: normalized.rotationQuarterTurns,
      snapped: true,
      snap: null,
      terrainHit: null,
      placedPieces: this.placedPieces,
      piecesById: this.piecesById,
      worldCells: this.deps.worldCells,
      config: this.config.placement,
    });
    if (!validation.valid) {
      console.warn(`[construction] skipped invalid saved piece ${normalized.id}: ${validation.reason ?? "invalid"}`);
      return;
    }
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(piece.dimensionsM[0], piece.dimensionsM[1], piece.dimensionsM[2]),
      new THREE.MeshStandardMaterial({ color: MATERIAL_COLORS[piece.material], roughness: 0.78 }),
    );
    mesh.name = `construction-${normalized.typeId}`;
    mesh.position.set(normalized.position[0], normalized.position[1], normalized.position[2]);
    mesh.rotation.set(0, normalized.rotationQuarterTurns * Math.PI * 0.5, 0);
    this.root.add(mesh);
    this.placedMeshes.push(mesh);
    this.placedPieces.push(normalized);
    this.snapIndex.addPiece(piece, normalized.id, normalized.position, normalized.rotationQuarterTurns);
    if (logPlacement) console.info(`[construction] placed ${piece.label} at ${normalized.position.map((v) => v.toFixed(2)).join(", ")}`);
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
        const placed = this.normalizePlacedPiece(entry);
        if (!placed || !this.piecesById.has(placed.typeId)) continue;
        const suffix = Number(placed.id.startsWith(ENTITY_ID_PREFIX) ? placed.id.slice(ENTITY_ID_PREFIX.length) : NaN);
        if (Number.isInteger(suffix) && suffix >= this.nextEntityId) this.nextEntityId = suffix + 1;
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

  private normalizePlacedPiece(value: unknown): PlacedConstructionPiece | null {
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    const position = asFiniteVec3(record.position);
    const rotation = Number(record.rotationQuarterTurns);
    if (typeof record.id !== "string" || typeof record.typeId !== "string" || !position || !Number.isFinite(rotation)) {
      return null;
    }
    return {
      id: record.id,
      typeId: record.typeId,
      position,
      rotationQuarterTurns: normalizeRotationQuarterTurns(rotation),
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
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof HTMLElement
        ? event.target.closest<HTMLButtonElement>("button[data-piece-index]")
        : null;
      if (!target) return;
      const index = Number(target.dataset.pieceIndex);
      if (!Number.isInteger(index) || index < 0 || index >= this.config.pieces.length) return;
      this.selectedIndex = index;
      this.syncUi(true);
    };
    menu.addEventListener("click", onClick);
    this.disposers.push(() => menu.removeEventListener("click", onClick));
    document.body.appendChild(menu);
    return menu;
  }

  private syncUi(force = false): void {
    this.menu.style.display = this.active ? "grid" : "none";
    const selected = this.config.pieces[this.selectedIndex] ?? null;
    const candidate = this.currentCandidate;
    const status = candidate
      ? candidate.valid ? candidate.snapped ? "snapped" : "valid" : candidate.reason ?? "invalid"
      : "aim at terrain";
    const previewRotation = candidate?.rotationQuarterTurns ?? this.rotationQuarterTurns;
    const stateKey = [
      this.active ? "1" : "0",
      this.selectedIndex,
      this.snapEnabled ? "1" : "0",
      previewRotation,
      status,
      candidate?.valid ? "1" : "0",
      candidate?.snapped ? "1" : "0",
    ].join("|");
    if (!force && stateKey === this.lastUiStateKey) return;
    this.lastUiStateKey = stateKey;
    if (!this.active) return;

    const pieceButtons = this.config.pieces.map((piece, index) => {
      const selectedAttr = index === this.selectedIndex ? "true" : "false";
      return `<button type="button" data-piece-index="${index}" aria-pressed="${selectedAttr}" style="padding:6px 7px;border:1px solid #46515e;border-radius:3px;color:#dce5ee;background:${selectedAttr === "true" ? "#245781" : "#20262d"};cursor:pointer;font:inherit;">${index + 1}. ${escapeHtml(piece.label)}</button>`;
    }).join("");
    this.menu.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">
        <strong>Build</strong>
        <span style="color:#9fb0c0;">B close · R rotate · X snap</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;margin-bottom:6px;">${pieceButtons}</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;color:#cdd8e3;">
        <span>Selected: ${escapeHtml(selected?.label ?? "none")}</span>
        <span>Snap: ${this.snapEnabled ? "on" : "off"}</span>
        <span>Rot: ${previewRotation * 90}°${candidate?.snapped ? " auto" : ""}</span>
        <span>State: ${escapeHtml(status)}</span>
      </div>
    `;
  }
}
