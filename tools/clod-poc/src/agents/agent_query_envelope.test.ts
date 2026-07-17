import { describe, expect, it } from "vitest";
import { createAgentQueryEnvelope, stubAgentColliderHit } from "./agent_query_envelope.js";
import { createAgentSimEnvelope } from "./agent_sim_envelope.js";

describe("agent query envelope", () => {
  it("keeps stub collider checks deterministic", () => {
    expect(stubAgentColliderHit(32, 48)).toBe(stubAgentColliderHit(32, 48));
    expect(stubAgentColliderHit(0, 0)).toBe(true);
    expect(stubAgentColliderHit(16, 0)).toBe(false);
  });

  it("records terrain query timing and query count", () => {
    const sim = createAgentSimEnvelope({
      count: 6,
      seed: 42,
      centerX: 100,
      centerZ: 200,
      spreadM: 30,
      rings: { fullRadiusM: 64, midRadiusM: 256, midTickStride: 4 },
    });
    const query = createAgentQueryEnvelope({
      sim,
      centerX: 100,
      centerZ: 200,
      fullRadiusM: 64,
      midRadiusM: 256,
      budget: { fullQueries: 2, midQueries: 1, frozenQueries: 0 },
    });
    const counters: Record<string, number> = {};
    query.tick(counters);
    expect(counters["agent_terrain_query_ms"]).toBeGreaterThanOrEqual(0);
    expect(counters["agent_terrain_queries"]).toBe(12);
  });
});
