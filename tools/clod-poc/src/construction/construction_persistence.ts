import { asConstructionMaterial } from "./materials.js";
import {
  ENTITY_ID_PREFIX,
  asFiniteVec3,
  hasExplicitSupportMetadata,
  normalizeRotationQuarterTurns,
  readStringArray,
} from "./construction_controller_support.js";
import { validateStrictPersistedConstructionPlacement } from "./persisted_placement.js";
import type { ConstructionPieceDef, ConstructionPlacementConfig, PlacedConstructionPiece } from "./types.js";

export interface ConstructionPersistenceLoadInput {
  storageKey: string;
  piecesById: ReadonlyMap<string, ConstructionPieceDef>;
  placedPieces: readonly PlacedConstructionPiece[];
  worldCells: number;
  placement: ConstructionPlacementConfig;
  addPiece: (piece: PlacedConstructionPiece) => boolean;
}

export interface ConstructionPersistenceLoadResult {
  nextEntityId: number;
  rewritten: boolean;
}

export function normalizePersistedConstructionPiece(value: unknown): PlacedConstructionPiece | null {
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
  if (record.unsupported === true) normalized.unsupported = true;
  return normalized;
}

export function saveConstructionPieces(storageKey: string, pieces: readonly PlacedConstructionPiece[]): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(pieces));
  } catch (error) {
    console.warn("[construction] failed to save placed pieces", error);
  }
}

export function loadConstructionPieces(input: ConstructionPersistenceLoadInput): ConstructionPersistenceLoadResult {
  let nextEntityId = 1;
  try {
    const raw = localStorage.getItem(input.storageKey);
    if (!raw) return { nextEntityId, rewritten: false };
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return { nextEntityId, rewritten: false };

    let rewriteStorage = false;
    const pending: PlacedConstructionPiece[] = [];
    const seenIds = new Set<string>();
    for (const entry of parsed) {
      const placed = normalizePersistedConstructionPiece(entry);
      const piece = placed ? input.piecesById.get(placed.typeId) : null;
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
      const suffix = Number(placed.id.startsWith(ENTITY_ID_PREFIX) ? placed.id.slice(ENTITY_ID_PREFIX.length) : Number.NaN);
      if (Number.isInteger(suffix) && suffix >= nextEntityId) nextEntityId = suffix + 1;
      pending.push(placed);
    }

    let madeProgress = true;
    while (pending.length > 0 && madeProgress) {
      madeProgress = false;
      for (let index = pending.length - 1; index >= 0; index -= 1) {
        const placed = pending[index]!;
        const piece = input.piecesById.get(placed.typeId);
        if (!piece) {
          pending.splice(index, 1);
          rewriteStorage = true;
          continue;
        }
        const validation = validateStrictPersistedConstructionPlacement({
          piece,
          placed,
          placedPieces: input.placedPieces,
          piecesById: input.piecesById,
          worldCells: input.worldCells,
          config: input.placement,
        });
        if (validation.valid) {
          pending.splice(index, 1);
          if (input.addPiece(placed)) {
            madeProgress = true;
          } else {
            console.warn(`[construction] skipped saved piece ${placed.id}: runtime insertion rejected`);
            rewriteStorage = true;
          }
          continue;
        }
        if (validation.reason !== "unsupported") {
          console.warn(`[construction] skipped invalid saved piece ${placed.id}: ${validation.reason ?? "invalid"}`);
          pending.splice(index, 1);
          rewriteStorage = true;
        }
      }
    }

    for (const placed of pending) console.warn(`[construction] skipped invalid saved piece ${placed.id}: unsupported`);
    if (pending.length > 0) rewriteStorage = true;
    if (rewriteStorage || input.placedPieces.length !== parsed.length) saveConstructionPieces(input.storageKey, input.placedPieces);
    return { nextEntityId, rewritten: rewriteStorage };
  } catch (error) {
    console.warn("[construction] failed to load saved pieces", error);
    return { nextEntityId, rewritten: false };
  }
}
