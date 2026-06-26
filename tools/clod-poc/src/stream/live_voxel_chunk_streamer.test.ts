import { describe, expect, it } from "vitest";
import { resolveStreamingOwnership } from "../streaming/streaming_ownership.js";
import { evictableLiveChunks } from "./live_chunk_eviction.js";
import { LiveVoxelChunkStreamer, requiredLiveChunks } from "./live_voxel_chunk_streamer.js";

const ownership = resolveStreamingOwnership({
  streaming: { preload_seconds: 4, live_radius_m: 128, clod_radius_m: 512 },
  targetVisibleM: 1024,
  streamingScene: true,
});

describe("live voxel chunk planning", () => {
  it("plans sorted required live chunks", () => {
    const keys = requiredLiveChunks({ x: 0, z: 0 }, ownership, { chunkSizeM: 64 });
    expect(keys.length).toBeGreaterThan(0);
    expect(keys).toEqual([...keys].sort());
  });

  it("marks distant chunks evictable after hysteresis", () => {
    const evictable = evictableLiveChunks(["0,0", "99,99"], { x: 0, z: 0 }, ownership, { chunkSizeM: 64 }, 64);
    expect(evictable).toEqual(["99,99"]);
  });

  it("tracks loaded chunks and evicts stale chunks", () => {
    const streamer = new LiveVoxelChunkStreamer(ownership, { chunkSizeM: 64, hysteresisM: 64 });
    const first = streamer.update({ x: 0, z: 0 });
    expect(first.loaded).toEqual(first.required);

    const second = streamer.update({ x: 2048, z: 0 });
    expect(second.evictable.length).toBeGreaterThan(0);
    expect(second.loaded).toEqual(second.required);
  });
});
