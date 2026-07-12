import { describe, expect, it } from "vitest";
import { heightfieldTileBuildAllowed } from "./heightfield_tile_client_runtime.js";

function idleCounters(overrides: Record<string, number> = {}): Record<string, number> {
  return {
    live_clod_stream_required_pages: 4,
    live_clod_stream_ready_pages: 4,
    live_clod_stream_pending_pages: 0,
    live_clod_stream_inflight_batches: 0,
    live_clod_stream_apply_queue_pages: 0,
    live_clod_stream_safety_pending_pages: 0,
    live_clod_stream_safety_inflight_pages: 0,
    ...overrides,
  };
}

describe("heightfieldTileBuildAllowed", () => {
  it("blocks until streamed-root counters exist", () => {
    expect(heightfieldTileBuildAllowed(undefined)).toBe(false);
    expect(heightfieldTileBuildAllowed({})).toBe(false);
    expect(heightfieldTileBuildAllowed({ live_clod_stream_required_pages: 4 })).toBe(false);
  });

  it("blocks before required streamed roots are ready", () => {
    expect(heightfieldTileBuildAllowed(idleCounters({ live_clod_stream_ready_pages: 0 }))).toBe(false);
  });

  it.each([
    "live_clod_stream_pending_pages",
    "live_clod_stream_inflight_batches",
    "live_clod_stream_apply_queue_pages",
    "live_clod_stream_safety_pending_pages",
    "live_clod_stream_safety_inflight_pages",
  ])("blocks while %s is non-zero", (key) => {
    expect(heightfieldTileBuildAllowed(idleCounters({ [key]: 1 }))).toBe(false);
  });

  it("allows builds after streamed-root queues drain", () => {
    expect(heightfieldTileBuildAllowed(idleCounters())).toBe(true);
    expect(heightfieldTileBuildAllowed(idleCounters({
      live_clod_stream_required_pages: 0,
      live_clod_stream_ready_pages: 0,
    }))).toBe(true);
  });
});
