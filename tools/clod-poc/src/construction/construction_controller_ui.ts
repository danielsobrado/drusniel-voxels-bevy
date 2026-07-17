import { BUILD_POINTER_OPTIONS, MENU_ID } from "./construction_controller_support.js";
import { renderConstructionMenuHtml } from "./construction_menu_render.js";
import { CONSTRUCTION_MATERIAL_OPTIONS } from "./materials.js";
import type { ConstructionMaterial, ConstructionPieceDef } from "./types.js";

export interface ConstructionControllerUiCallbacks {
  isActive: () => boolean;
  onToggleActive: () => void;
  onToggleSnap: () => void;
  onSnapSuppressedChange: (suppressed: boolean) => void;
  onCycleSnap: (direction: number) => void;
  onRotate: () => void;
  onMaterialStep: (direction: number) => void;
  onMaterialSelect: (index: number) => void;
  onPieceSelect: (index: number) => void;
  onPlace: () => void;
  onDelete: () => void;
  onPickPiece: () => void;
  onPointerUpdate: (event: PointerEvent) => boolean;
  onPointerLeave: () => void;
  onInputUnavailable: () => void;
}

export interface ConstructionControllerUiState {
  active: boolean;
  snapEnabled: boolean;
  snapSuppressed: boolean;
  pieces: readonly ConstructionPieceDef[];
  selectedIndex: number;
  selectedPieceId: string;
  rotationQuarterTurns: number;
  placedPieces: number;
  indexedSnapPoints: number;
  currentValid: boolean;
  currentReason: string | null;
  currentStability: number | null;
  currentMaxSupport: number | null;
  currentGrounded: boolean;
  pendingCollapses: number;
  materialOptions: typeof CONSTRUCTION_MATERIAL_OPTIONS;
  selectedMaterial: ConstructionMaterial;
  lastMessage: string;
}

export interface ConstructionControllerUi {
  render(state: ConstructionControllerUiState, force?: boolean): void;
  dispose(): void;
}

export function createConstructionControllerUi(
  domElement: HTMLElement,
  callbacks: ConstructionControllerUiCallbacks,
): ConstructionControllerUi {
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
    width: "min(560px, calc(100vw - 16px))",
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

  let lastStateKey = "";
  let dragOffset: { x: number; y: number } | null = null;
  let shiftSuppressed = false;

  const setShiftSuppressed = (suppressed: boolean) => {
    if (shiftSuppressed === suppressed) return;
    shiftSuppressed = suppressed;
    callbacks.onSnapSuppressedChange(suppressed);
  };

  const onMenuClick = (event: MouseEvent) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target) return;
    const materialStep = target.closest<HTMLButtonElement>("button[data-material-step]");
    if (materialStep) {
      const step = Number(materialStep.dataset.materialStep);
      if (Number.isFinite(step)) callbacks.onMaterialStep(step);
      return;
    }
    const materialButton = target.closest<HTMLButtonElement>("button[data-material-index]");
    if (materialButton) {
      const index = Number(materialButton.dataset.materialIndex);
      if (Number.isInteger(index)) callbacks.onMaterialSelect(index);
      return;
    }
    const pieceButton = target.closest<HTMLButtonElement>("button[data-piece-index]");
    if (!pieceButton) return;
    const index = Number(pieceButton.dataset.pieceIndex);
    if (Number.isInteger(index)) callbacks.onPieceSelect(index);
  };

  const onMenuPointerDown = (event: PointerEvent) => {
    const handle = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-drag-handle]") : null;
    if (!handle) return;
    event.preventDefault();
    const rect = menu.getBoundingClientRect();
    dragOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.top}px`;
    menu.style.transform = "none";
    menu.style.bottom = "auto";
    menu.style.right = "auto";
    menu.style.cursor = "grabbing";
    const onMove = (moveEvent: PointerEvent) => {
      if (!dragOffset) return;
      menu.style.left = `${moveEvent.clientX - dragOffset.x}px`;
      menu.style.top = `${moveEvent.clientY - dragOffset.y}px`;
    };
    const onUp = () => {
      dragOffset = null;
      menu.style.cursor = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const onPointerMove = (event: PointerEvent) => callbacks.onPointerUpdate(event);
  const onPointerLeave = () => callbacks.onPointerLeave();
  const onPointerDown = (event: PointerEvent) => {
    if (!callbacks.isActive()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!callbacks.onPointerUpdate(event)) {
      callbacks.onInputUnavailable();
      return;
    }
    if (event.button === 0) callbacks.onPlace();
    else if (event.button === 1) callbacks.onPickPiece();
    else if (event.button === 2) callbacks.onDelete();
  };
  const onContextMenu = (event: MouseEvent) => {
    if (!callbacks.isActive()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (isTextInputEvent(event)) return;
    if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
      if (callbacks.isActive()) setShiftSuppressed(true);
      return;
    }
    if (event.code === "KeyB") {
      event.preventDefault();
      callbacks.onToggleActive();
      return;
    }
    if (!callbacks.isActive()) return;
    if (event.code === "KeyX") {
      event.preventDefault();
      callbacks.onToggleSnap();
    } else if (event.code === "KeyQ") {
      event.preventDefault();
      callbacks.onCycleSnap(-1);
    } else if (event.code === "KeyE") {
      event.preventDefault();
      callbacks.onCycleSnap(1);
    } else if (event.code === "KeyR") {
      event.preventDefault();
      callbacks.onRotate();
    } else if (event.code === "ArrowLeft") {
      event.preventDefault();
      callbacks.onMaterialStep(-1);
    } else if (event.code === "ArrowRight") {
      event.preventDefault();
      callbacks.onMaterialStep(1);
    } else if (event.code.startsWith("Digit")) {
      const index = Number(event.code.slice(5)) - 1;
      if (Number.isInteger(index)) {
        event.preventDefault();
        callbacks.onPieceSelect(index);
      }
    }
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.code === "ShiftLeft" || event.code === "ShiftRight") setShiftSuppressed(false);
  };
  const onBlur = () => setShiftSuppressed(false);

  menu.addEventListener("click", onMenuClick);
  menu.addEventListener("pointerdown", onMenuPointerDown);
  domElement.addEventListener("pointermove", onPointerMove);
  domElement.addEventListener("pointerleave", onPointerLeave);
  domElement.addEventListener("pointerdown", onPointerDown, BUILD_POINTER_OPTIONS);
  domElement.addEventListener("contextmenu", onContextMenu, BUILD_POINTER_OPTIONS);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  document.body.appendChild(menu);

  return {
    render(state, force = false) {
      const stateKey = JSON.stringify({
        active: state.active,
        snapEnabled: state.snapEnabled,
        snapSuppressed: state.snapSuppressed,
        selectedIndex: state.selectedIndex,
        selectedMaterial: state.selectedMaterial,
        rotationQuarterTurns: state.rotationQuarterTurns,
        currentValid: state.currentValid,
        currentReason: state.currentReason,
        currentStability: state.currentStability,
        currentMaxSupport: state.currentMaxSupport,
        currentGrounded: state.currentGrounded,
        pendingCollapses: state.pendingCollapses,
        placedPieces: state.placedPieces,
        indexedSnapPoints: state.indexedSnapPoints,
        lastMessage: state.lastMessage,
      });
      if (!force && stateKey === lastStateKey) return;
      lastStateKey = stateKey;
      menu.innerHTML = renderConstructionMenuHtml({
        active: state.active,
        snapEnabled: state.snapEnabled,
        snapSuppressed: state.snapSuppressed,
        pieces: state.pieces,
        selectedPieceId: state.selectedPieceId,
        rotationQuarterTurns: state.rotationQuarterTurns,
        placedPieces: state.placedPieces,
        indexedSnapPoints: state.indexedSnapPoints,
        currentValid: state.currentValid,
        currentReason: state.currentReason,
        currentStability: state.currentStability,
        currentMaxSupport: state.currentMaxSupport,
        currentGrounded: state.currentGrounded,
        pendingCollapses: state.pendingCollapses,
        materialOptions: state.materialOptions,
        selectedMaterial: state.selectedMaterial,
        lastMessage: state.lastMessage,
      });
      menu.style.display = state.active ? "block" : "none";
    },
    dispose() {
      setShiftSuppressed(false);
      dragOffset = null;
      menu.removeEventListener("click", onMenuClick);
      menu.removeEventListener("pointerdown", onMenuPointerDown);
      domElement.removeEventListener("pointermove", onPointerMove);
      domElement.removeEventListener("pointerleave", onPointerLeave);
      domElement.removeEventListener("pointerdown", onPointerDown, BUILD_POINTER_OPTIONS);
      domElement.removeEventListener("contextmenu", onContextMenu, BUILD_POINTER_OPTIONS);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      menu.remove();
    },
  };
}

function isTextInputEvent(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}
