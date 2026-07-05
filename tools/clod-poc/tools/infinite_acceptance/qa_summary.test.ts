import { describe, expect, it } from "vitest";
import { buildInfiniteQaSummary } from "./qa_summary.js";

describe("buildInfiniteQaSummary", () => {
  it("includes live stream and hydrology areas", () => {
    const summary = buildInfiniteQaSummary("infinite-islands", {
      counters: {
        live_bubble_streamed_collider_pages: 4,
        live_clod_stream_radius_m: 2048,
        live_clod_stream_cached_pages: 7,
        infinite_hydrology_nonrepeat_ok: 1,
      },
    }) as {
      checkpoints: Array<{ areas: Record<string, Record<string, number>> }>;
    };

    const areas = summary.checkpoints[0]!.areas;

    expect(areas.live_bubble!.streamed_collider_pages).toBe(4);
    expect(areas.live_clod_stream!.radius_m).toBe(2048);
    expect(areas.live_clod_stream!.cached_pages).toBe(7);
    expect(areas.hydrology!.nonrepeat_ok).toBe(1);
  });
});
