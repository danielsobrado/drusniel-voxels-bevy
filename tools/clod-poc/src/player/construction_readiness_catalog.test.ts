import { describe, expect, it } from "vitest";
import { constructionBoundsFor } from "../construction/construction_bounds.js";
import { defaultConstructionConfig } from "../construction/config.js";
import { DEFAULT_CONSTRUCTION_ENVELOPE_RADIUS_M } from "./cell_readiness.js";

describe("construction readiness catalog envelope", () => {
  it("covers every configured piece at every quarter-turn rotation", () => {
    const violations: string[] = [];
    for (const piece of defaultConstructionConfig.pieces) {
      for (let rotationQuarterTurns = 0; rotationQuarterTurns < 4; rotationQuarterTurns += 1) {
        const bounds = constructionBoundsFor(piece, [0, 0, 0], rotationQuarterTurns);
        const horizontalReachM = Math.max(
          Math.abs(bounds.minX),
          Math.abs(bounds.maxX),
          Math.abs(bounds.minZ),
          Math.abs(bounds.maxZ),
        );
        if (horizontalReachM > DEFAULT_CONSTRUCTION_ENVELOPE_RADIUS_M + 1e-6) {
          violations.push(`${piece.id}@${rotationQuarterTurns}: ${horizontalReachM.toFixed(3)}m`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
