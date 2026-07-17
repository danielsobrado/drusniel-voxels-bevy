import { describe, expect, it } from "vitest";
import { createAgentSimEnvelope } from "./agent_sim_envelope.js";

describe("agent sim envelope", () => {
  it("produces deterministic positions for the same seed", () => {
    const config = {
      count: 12,
      seed: 1337,
      centerX: 1600,
      centerZ: 500,
      spreadM: 80,
      rings: { fullRadiusM: 64, midRadiusM: 256, midTickStride: 4 },
    };
    const left = createAgentSimEnvelope(config);
    const right = createAgentSimEnvelope(config);
    for (let index = 0; index < config.count; index += 1) {
      expect(left.positionAt(index)).toEqual(right.positionAt(index));
    }
  });

  it("publishes ring counters and advances positions after ticks", () => {
    const counters: Record<string, number> = {};
    const envelope = createAgentSimEnvelope({
      count: 8,
      seed: 9,
      centerX: 0,
      centerZ: 0,
      spreadM: 40,
      rings: { fullRadiusM: 64, midRadiusM: 256, midTickStride: 4 },
    });
    const before = envelope.positionAt(0);
    envelope.tick(1, counters);
    const after = envelope.positionAt(0);
    expect(counters["agents_full"]).toBe(8);
    expect(counters["agents_mid"]).toBe(0);
    expect(counters["agents_frozen"]).toBe(0);
    expect(counters["agent_sim_ms"]).toBeGreaterThanOrEqual(0);
    expect(after.x !== before.x || after.z !== before.z).toBe(true);
  });
});
