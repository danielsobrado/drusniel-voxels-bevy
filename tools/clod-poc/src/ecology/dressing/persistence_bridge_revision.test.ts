import { describe, expect, it } from "vitest";
import { DressingPersistenceBridge } from "./persistence_bridge.js";
import { stableIdKey, terrainDressingStableId } from "./stable_id.js";

describe("dressing persistence exclusion publication", () => {
  it("publishes sorted two-word exclusions with a monotonic revision", () => {
    const bridge = new DressingPersistenceBridge();
    const first = terrainDressingStableId({
      worldSeed: 9,
      classId: "dead_log_rotten",
      cellX: 5,
      cellZ: 8,
      generatorSchemaVersion: 1,
    });
    const second = terrainDressingStableId({
      worldSeed: 9,
      classId: "large_talus_boulder",
      cellX: -2,
      cellZ: 4,
      generatorSchemaVersion: 1,
    });

    expect(bridge.revision).toBe(0);
    bridge.record({ stableId: first, classId: "dead_log_rotten", state: "destroyed" });
    bridge.record({ stableId: second, classId: "large_talus_boulder", state: "harvested" });

    expect(bridge.revision).toBe(2);
    expect(bridge.exclusionSnapshot().map(stableIdKey)).toEqual(
      [stableIdKey(first), stableIdKey(second)].sort(),
    );
  });

  it("removes moved or replaced identities from the exclusion snapshot", () => {
    const bridge = new DressingPersistenceBridge();
    const id = terrainDressingStableId({
      worldSeed: 12,
      classId: "dead_log_fresh",
      cellX: 1,
      cellZ: 2,
      generatorSchemaVersion: 1,
    });
    bridge.record({ stableId: id, classId: "dead_log_fresh", state: "destroyed" });
    bridge.record({
      stableId: id,
      classId: "dead_log_fresh",
      state: "moved",
      transformOverride: {
        position: [1, 2, 3],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      },
    });

    expect(bridge.revision).toBe(2);
    expect(bridge.exclusionSnapshot()).toEqual([]);
  });

  it("does not mutate current state when restore validation fails", () => {
    const bridge = new DressingPersistenceBridge();
    const id = terrainDressingStableId({
      worldSeed: 4,
      classId: "broken_snag",
      cellX: 6,
      cellZ: 7,
      generatorSchemaVersion: 1,
    });
    bridge.record({ stableId: id, classId: "broken_snag", state: "destroyed" });
    const revision = bridge.revision;
    const snapshot = bridge.exclusionSnapshot();

    expect(() => bridge.restore([{
      stableId: "1234567890abcdef",
      classId: "moss_patch" as never,
      state: "destroyed",
    }])).toThrow(/persistent/i);

    expect(bridge.revision).toBe(revision);
    expect(bridge.exclusionSnapshot()).toEqual(snapshot);
  });
});
