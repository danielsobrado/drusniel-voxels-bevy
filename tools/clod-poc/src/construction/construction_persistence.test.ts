import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConstructionPieces } from "./construction_persistence.js";
import type { ConstructionPieceDef, ConstructionPlacementConfig, PlacedConstructionPiece } from "./types.js";

const STORAGE_KEY = "construction-persistence-test";
const FLOOR: ConstructionPieceDef = {
  id: "floor",
  label: "Floor",
  category: "floor",
  dimensionsM: [2, 0.2, 2],
  canGround: true,
  material: "wood",
  snapPoints: [],
};
const PLACEMENT: ConstructionPlacementConfig = {
  maxRayDistanceM: 100,
  terrainStepM: 0.5,
  overlapPaddingM: 0.05,
  storageKey: STORAGE_KEY,
};

let restoreLocalStorage: (() => void) | null = null;

function stubLocalStorage(): Map<string, string> {
  const values = new Map<string, string>();
  const original = (globalThis as { localStorage?: unknown }).localStorage;
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => { values.clear(); },
  };
  restoreLocalStorage = () => {
    if (original === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
    else (globalThis as { localStorage?: unknown }).localStorage = original;
  };
  return values;
}

function savedFloor(): PlacedConstructionPiece {
  return {
    id: "construction-1",
    typeId: FLOOR.id,
    position: [10, 0.1, 10],
    rotationQuarterTurns: 0,
    grounded: true,
    parentIds: [],
  };
}

afterEach(() => {
  restoreLocalStorage?.();
  restoreLocalStorage = null;
  vi.restoreAllMocks();
});

describe("loadConstructionPieces", () => {
  it("rewrites storage when the runtime store rejects an otherwise valid piece", () => {
    const storage = stubLocalStorage();
    storage.set(STORAGE_KEY, JSON.stringify([savedFloor()]));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const placedPieces: PlacedConstructionPiece[] = [];
    const result = loadConstructionPieces({
      storageKey: STORAGE_KEY,
      piecesById: new Map([[FLOOR.id, FLOOR]]),
      placedPieces,
      worldCells: 1000,
      placement: PLACEMENT,
      addPiece: () => false,
    });

    expect(result.rewritten).toBe(true);
    expect(JSON.parse(storage.get(STORAGE_KEY)!)).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("runtime insertion rejected"));
  });
});
