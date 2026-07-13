import { describe, expect, it } from "vitest";
import { buildHeightfieldTile } from "./heightfield_tile.js";
import { collectHeightfieldTileTransferables } from "./heightfield_tile_worker_protocol.js";

describe("heightfield tile worker protocol", () => {
  it("transfers one authoritative f32 buffer per tile", () => {
    const tiles = [
      buildHeightfieldTile({ x: 0, z: 0 }, { sampleHeight: () => 1 }),
      buildHeightfieldTile({ x: -1, z: 2 }, { sampleHeight: () => 2 }),
    ];
    const transferables = collectHeightfieldTileTransferables(tiles);

    expect(transferables).toEqual(tiles.map((tile) => tile.heights.buffer));
    expect(new Set(transferables).size).toBe(2);
  });
});
