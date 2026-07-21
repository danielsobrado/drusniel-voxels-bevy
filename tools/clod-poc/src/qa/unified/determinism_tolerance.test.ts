import { describe, expect, it } from "vitest";
import { compareJsonValues } from "./determinism.js";

describe("path-specific deterministic tolerances", () => {
  it("keeps counters exact while allowing bounded visual vectors", () => {
    const differences = compareJsonValues(
      { counters: { pages: 8 }, signature: { grid: [0.1, 0.2] } },
      { counters: { pages: 9 }, signature: { grid: [0.102, 0.198] } },
      new Set(),
      {
        defaultTolerance: 0,
        pathTolerances: { "$.signature.grid[*]": 0.003 },
      },
    );
    expect(differences).toHaveLength(1);
    expect(differences[0]).toContain("$.counters.pages");
  });

  it("supports recursive wildcard paths", () => {
    const differences = compareJsonValues(
      { captures: [{ sanity: { metrics: { mean: 0.1, edge: 0.2 } } }] },
      { captures: [{ sanity: { metrics: { mean: 0.104, edge: 0.196 } } }] },
      new Set(),
      {
        defaultTolerance: 0,
        pathTolerances: { "$.captures[*].sanity.metrics.**": 0.005 },
      },
    );
    expect(differences).toEqual([]);
  });
});
