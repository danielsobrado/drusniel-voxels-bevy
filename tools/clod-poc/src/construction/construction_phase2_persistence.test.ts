import { describe, expect, it } from "vitest";
import { normalizePersistedConstructionPiece } from "./construction_persistence.js";

describe("construction Phase 2 persistence", () => {
  it("round-trips graph and stability metadata", () => {
    expect(normalizePersistedConstructionPiece({
      id: "piece-3",
      typeId: "wood-floor-2x2",
      position: [1, 2, 3],
      rotationQuarterTurns: 1,
      material: "wood",
      grounded: false,
      parentIds: ["piece-1", "piece-2"],
      connectionIds: ["piece-1", "piece-2"],
      stability: 0.72,
      collapsePending: true,
      unsupported: true,
    })).toMatchObject({
      id: "piece-3",
      connectionIds: ["piece-1", "piece-2"],
      stability: 0.72,
      collapsePending: true,
      unsupported: true,
    });
  });
});
