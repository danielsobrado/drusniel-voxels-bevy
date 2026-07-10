import { describe, expect, it } from "vitest";
import { StreamRootEditState } from "./stream_root_edit_state.js";

describe("StreamRootEditState", () => {
  it("keeps edited roots CPU-authoritative after their dirty rebuild is acknowledged", () => {
    const state = new StreamRootEditState();
    state.markDirty("L0:1,2");
    const snapshot = state.captureDirty(["L0:1,2"]);

    state.acknowledge(snapshot);

    expect(state.captureDirty(["L0:1,2"]).size).toBe(0);
    expect(state.cpuAuthoritative(["L0:1,2", "L0:9,9"])).toEqual(["L0:1,2"]);
    expect(state.requiresCpu(["L0:1,2"])).toBe(true);
  });

  it("does not clear a newer edit completed while a rebuild was in flight", () => {
    const state = new StreamRootEditState();
    state.markDirty("L0:1,2");
    const snapshot = state.captureDirty(["L0:1,2"]);
    state.markDirty("L0:1,2");

    state.acknowledge(snapshot);

    expect(state.captureDirty(["L0:1,2"]).size).toBe(1);
  });

  it("resets CPU authority when a new world is installed", () => {
    const state = new StreamRootEditState();
    state.markDirty("L0:1,2");

    state.reset();

    expect(state.requiresCpu(["L0:1,2"])).toBe(false);
    expect(state.cpuAuthoritative(["L0:1,2"])).toEqual([]);
    expect(state.captureDirty(["L0:1,2"]).size).toBe(0);
  });
});
