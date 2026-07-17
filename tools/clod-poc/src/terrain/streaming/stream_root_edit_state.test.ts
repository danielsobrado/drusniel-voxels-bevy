import { beforeEach, describe, expect, it } from "vitest";
import {
  resetTerrainStreamingControlForTests,
  setTerrainStreamingEnabled,
} from "../../stream/terrain_streaming_control.js";
import { StreamRootEditState } from "./stream_root_edit_state.js";

beforeEach(() => resetTerrainStreamingControlForTests());

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

  it("does not acknowledge a dirty rebuild after the streaming generation changes", () => {
    const state = new StreamRootEditState();
    state.markDirty("L0:1,2");
    const snapshot = state.captureDirty(["L0:1,2"]);

    setTerrainStreamingEnabled(false);
    setTerrainStreamingEnabled(true);
    state.acknowledge(snapshot);

    expect(state.captureDirty(["L0:1,2"]).size).toBe(1);
    expect(state.requiresCpu(["L0:1,2"])).toBe(true);
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
