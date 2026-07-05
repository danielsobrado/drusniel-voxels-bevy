import { describe, expect, it } from "vitest";
import type { VoxelDelta } from "../../terrain/voxel_edits/voxel_edit_types.js";
import { openSaveDb, readRegionRecords, writeRegionRecords } from "../save_db.js";
import { regionVoxelDeltasToDeltas, type RegionVoxelDeltas } from "../save_schema.js";
import { decodeVoxelDeltasBin1, encodeVoxelDeltasBin1 } from "../voxel_delta_binary.js";
import { indexedDB } from "fake-indexeddb";

function deltas(): VoxelDelta[] {
  return [
    { x: -1, y: 2, z: -3, density: 0.5, materialSlot: 4, revision: 9 },
    { x: 512, y: -8, z: 1024, density: -0.25, revision: 10 },
    { x: -9, y: 3, z: 4, density: 1.25, materialSlot: -1, revision: 11 },
  ];
}

function dbName(): string {
  return `drusniel-bin1-test-${Date.now()}-${Math.random()}`;
}

describe("voxel delta bin1 payloads", () => {
  it("keeps json records readable", () => {
    const record: RegionVoxelDeltas = { schemaVersion: 1, regionKey: "r_0_0", format: "json", deltas: deltas() };
    expect(regionVoxelDeltasToDeltas(record)).toEqual(deltas());
  });

  it("round-trips negative coordinates and material slots exactly", () => {
    const encoded = encodeVoxelDeltasBin1(deltas());
    expect(decodeVoxelDeltasBin1(encoded)).toEqual(deltas());
  });

  it("rejects corrupt headers and unsupported versions", () => {
    const corrupt = encodeVoxelDeltasBin1(deltas());
    corrupt[0] = 0;
    expect(() => decodeVoxelDeltasBin1(corrupt)).toThrow(/header/i);

    const unsupported = encodeVoxelDeltasBin1(deltas());
    new DataView(unsupported.buffer).setUint16(4, 99, true);
    expect(() => decodeVoxelDeltasBin1(unsupported)).toThrow(/unsupported/i);
  });

  it("survives IndexedDB reopen", async () => {
    const name = dbName();
    let db = await openSaveDb(indexedDB, name);
    await writeRegionRecords(db, "qa-save", {
      manifest: {
        schemaVersion: 1,
        regionKey: "r_0_0",
        rx: 0,
        rz: 0,
        revision: 1,
        authorityRevision: 11,
        voxelDeltaCount: 3,
        propCount: 0,
        updatedAt: "2026-07-05T00:00:01.000Z",
      },
      voxelDeltas: { schemaVersion: 1, regionKey: "r_0_0", format: "bin1", payload: encodeVoxelDeltasBin1(deltas()) },
      props: [],
    });
    db.close();

    db = await openSaveDb(indexedDB, name);
    const loaded = await readRegionRecords(db, "qa-save", "r_0_0");
    db.close();

    expect(loaded).not.toBeNull();
    expect(loaded ? regionVoxelDeltasToDeltas(loaded.voxelDeltas) : []).toEqual(deltas());
  });
});
