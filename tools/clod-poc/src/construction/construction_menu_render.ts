import {
  CONSTRUCTION_MATERIAL_OPTIONS,
  constructionMaterialLabel,
} from "./materials.js";
import type { ConstructionCandidate, ConstructionMaterial, ConstructionPieceDef } from "./types.js";
import { escapeHtml, escapeStyleUrl } from "./construction_controller_support.js";

export interface ConstructionMenuRenderInput {
  pieces: readonly ConstructionPieceDef[];
  selectedPiece?: ConstructionPieceDef | null;
  selectedPieceId?: string | null;
  selectedIndex?: number;
  selectedMaterial: ConstructionMaterial;
  snapEnabled: boolean;
  snapSuppressed?: boolean;
  currentCandidate?: ConstructionCandidate | null;
  currentValid?: boolean;
  currentReason?: string | null;
  currentStability?: number | null;
  currentMaxSupport?: number | null;
  currentGrounded?: boolean;
  pendingCollapses?: number;
  lastPlacementMessage?: string;
  lastMessage?: string;
  active?: boolean;
  rotationQuarterTurns?: number;
  placedPieces?: number;
  indexedSnapPoints?: number;
  materialOptions?: typeof CONSTRUCTION_MATERIAL_OPTIONS;
}

function resolveSelectedIndex(input: ConstructionMenuRenderInput): number {
  if (Number.isInteger(input.selectedIndex) && input.selectedIndex! >= 0 && input.selectedIndex! < input.pieces.length) {
    return input.selectedIndex!;
  }
  if (input.selectedPieceId) {
    const index = input.pieces.findIndex((piece) => piece.id === input.selectedPieceId);
    if (index >= 0) return index;
  }
  return 0;
}

function resolveSelectedPiece(input: ConstructionMenuRenderInput, selectedIndex: number): ConstructionPieceDef | null {
  return input.selectedPiece ?? input.pieces[selectedIndex] ?? null;
}

function stabilityLabel(value: number, maxSupport: number, grounded: boolean): string {
  if (grounded) return "Grounded";
  const ratio = maxSupport > 0 ? value / maxSupport : 0;
  if (ratio >= 0.67) return "Strong";
  if (ratio >= 0.40) return "Moderate";
  if (ratio >= 0.20) return "Weak";
  return "Unstable";
}

function resolveStatus(input: ConstructionMenuRenderInput): string {
  const candidate = input.currentCandidate;
  if (candidate) {
    if (!candidate.valid) return `Blocked: ${escapeHtml(candidate.reason ?? "invalid")}`;
    const percent = Math.round((candidate.stabilityMaxSupport > 0
      ? candidate.stabilityValue / candidate.stabilityMaxSupport
      : 0) * 100);
    return `${stabilityLabel(candidate.stabilityValue, candidate.stabilityMaxSupport, candidate.stabilityGrounded)} · ${percent}%`;
  }
  if (typeof input.currentValid === "boolean") {
    if (!input.currentValid) return input.currentReason
      ? `Blocked: ${escapeHtml(input.currentReason)}`
      : "Aim at terrain or snap point";
    const value = input.currentStability ?? 0;
    const maxSupport = input.currentMaxSupport ?? 1;
    return stabilityLabel(value, maxSupport, input.currentGrounded === true);
  }
  return "Aim at terrain or snap point";
}

export function renderConstructionMenuHtml(input: ConstructionMenuRenderInput): string {
  const selectedIndex = resolveSelectedIndex(input);
  const selectedPiece = resolveSelectedPiece(input, selectedIndex);
  const materialOptions = input.materialOptions ?? CONSTRUCTION_MATERIAL_OPTIONS;
  const pieceButtons = input.pieces.map((piece, index) => {
    const active = index === selectedIndex;
    return `<button data-piece-index="${index}" style="${buttonStyle(active)}">${index + 1}. ${escapeHtml(piece.label)}</button>`;
  }).join("");
  const materialButtons = materialOptions.map((option, index) => {
    const active = option.id === input.selectedMaterial;
    const label = escapeHtml(option.label);
    const preview = escapeStyleUrl(option.previewUrl);
    return `<button data-material-index="${index}" title="${label}" style="${swatchStyle(active, option.color, preview)}"><span>${label}</span></button>`;
  }).join("");
  const status = resolveStatus(input);
  const lastMessage = input.lastPlacementMessage ?? input.lastMessage ?? "";
  const snapLabel = input.snapEnabled
    ? input.snapSuppressed ? "Snap HELD OFF" : "Snap ON"
    : "Snap OFF";
  const rotationDegrees = ((input.rotationQuarterTurns ?? 0) % 4 + 4) % 4 * 90;
  const collapseLabel = (input.pendingCollapses ?? 0) > 0 ? ` · ${input.pendingCollapses} collapse queued` : "";
  return `
      <div data-drag-handle style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:8px;cursor:grab;">
        <strong>Build</strong>
        <span>${selectedPiece ? escapeHtml(selectedPiece.label) : "No pieces"} · ${escapeHtml(constructionMaterialLabel(input.selectedMaterial))}</span>
        <span>${snapLabel} · ${rotationDegrees}°</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:8px;">${pieceButtons}</div>
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
        <button data-material-step="-1" style="${buttonStyle(false)}">◀</button>
        <div style="display:grid;grid-template-columns:repeat(${Math.min(6, materialOptions.length)}, minmax(0, 1fr));gap:5px;flex:1;">${materialButtons}</div>
        <button data-material-step="1" style="${buttonStyle(false)}">▶</button>
      </div>
      <div style="display:flex;justify-content:space-between;gap:8px;">
        <span>${status}${collapseLabel}</span>
        <span>R rotate · Q/E snap · hold Shift free · middle-click pick</span>
      </div>
      ${lastMessage ? `<div style="margin-top:6px;color:#ffd27a;">${escapeHtml(lastMessage)}</div>` : ""}
    `;
}

function buttonStyle(active: boolean): string {
  return [
    "border:1px solid rgba(160,190,230,0.35)",
    `background:${active ? "rgba(80,150,255,0.42)" : "rgba(255,255,255,0.07)"}`,
    "color:#eef3f8",
    "border-radius:6px",
    "padding:5px 7px",
    "font:inherit",
    "cursor:pointer",
  ].join(";");
}

function swatchStyle(active: boolean, color: number, backgroundUrl: string): string {
  return [
    "height:38px",
    "border-radius:7px",
    `border:${active ? "2px solid #9bd3ff" : "1px solid rgba(160,190,230,0.35)"}`,
    "color:#fff",
    "font:10px/1.1 system-ui,sans-serif",
    "text-shadow:0 1px 2px rgba(0,0,0,0.8)",
    "cursor:pointer",
    "overflow:hidden",
    backgroundUrl
      ? `background-image:linear-gradient(rgba(0,0,0,0.18),rgba(0,0,0,0.38)),url('${backgroundUrl}')`
      : `background:#${color.toString(16).padStart(6, "0")}`,
    "background-size:cover",
    "background-position:center",
  ].join(";");
}
