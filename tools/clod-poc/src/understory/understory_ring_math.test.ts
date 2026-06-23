import { describe, expect, it } from "vitest";
import {
  cloneUnderstorySettings,
  UNDERSTORY_CLASSES,
  type UnderstorySettings,
} from "./understory_config.js";
import {
  emptyUnderstoryRingCounts,
  packUnderstoryRingClassParams,
  packUnderstoryRingParams,
  resolveUnderstoryRingReadbackCounts,
  understoryPcg2d,
  understoryRingAcceptParams,
  understoryRingCell,
  understoryRingCullWorkgroups,
  understoryRingGrid,
  understoryRingGroupCapacity,
  understoryRingGroupClass,
  understoryRingGroupIndex,
  understoryRingGroupRegion,
  understoryRingHash,
  understoryRingSlotCount,
  understoryRingTerrainGate,
  UNDERSTORY_RING_CLASS_STRIDE_F32,
  UNDERSTORY_RING_GROUP_COUNT,
  UNDERSTORY_RING_PARAM_BYTES,
  understoryWorldCellFromSlot,
} from "./understory_ring_math.js";

function settings(overrides: Partial<UnderstorySettings> = {}): UnderstorySettings {
  return { ...cloneUnderstorySettings(), ...overrides };
}

describe("understory ring group layout", () => {
  it("maps every class to a stable group index and back", () => {
    expect(UNDERSTORY_RING_GROUP_COUNT).toBe(UNDERSTORY_CLASSES.length);
    UNDERSTORY_CLASSES.forEach((cls, index) => {
      expect(understoryRingGroupIndex(cls)).toBe(index);
      expect(understoryRingGroupClass(index)).toBe(cls);
    });
  });

  it("clamps out-of-range group indices to the valid class range", () => {
    expect(understoryRingGroupClass(-5)).toBe(UNDERSTORY_CLASSES[0]);
    expect(understoryRingGroupClass(999)).toBe(UNDERSTORY_CLASSES[UNDERSTORY_CLASSES.length - 1]);
  });

  it("computes non-overlapping per-group regions", () => {
    const cap = understoryRingGroupCapacity(settings());
    for (let group = 0; group < UNDERSTORY_RING_GROUP_COUNT; group++) {
      const region = understoryRingGroupRegion(group, cap);
      expect(region.start).toBe(group * cap);
      expect(region.firstInstance).toBe(group * cap);
      expect(region.end - region.start).toBe(cap);
    }
  });
});

describe("understory ring grid sizing", () => {
  it("derives the grid and slot count from distance / spacing", () => {
    const s = settings();
    expect(understoryRingCell(s)).toBe(s.placement.spacingM);
    const grid = Math.ceil((s.distanceM * 2) / s.placement.spacingM);
    expect(understoryRingGrid(s)).toBe(grid);
    expect(understoryRingSlotCount(s)).toBe(grid * grid);
  });

  it("splits maxVisible evenly across class groups", () => {
    const s = settings();
    s.gpu.maxVisible = 12000;
    expect(understoryRingGroupCapacity(s)).toBe(2000);
  });

  it("covers every slot with at least one workgroup", () => {
    const s = settings();
    const workgroups = understoryRingCullWorkgroups(s);
    expect(workgroups * s.gpu.workgroupSize).toBeGreaterThanOrEqual(understoryRingSlotCount(s));
  });
});

describe("understory toroidal world cell", () => {
  it("keeps slots within one grid span of the camera cell", () => {
    const s = settings();
    const grid = understoryRingGrid(s);
    const cell = understoryRingCell(s);
    const cameraX = 512.4;
    const cameraZ = -88.1;
    const camCellX = cameraX / cell;
    const camCellZ = cameraZ / cell;
    for (const slot of [0, 1, grid + 3, grid * grid - 1]) {
      const [cx, cz] = understoryWorldCellFromSlot(slot, grid, cell, cameraX, cameraZ);
      expect(Math.abs(cx - camCellX)).toBeLessThanOrEqual(grid);
      expect(Math.abs(cz - camCellZ)).toBeLessThanOrEqual(grid);
    }
  });
});

describe("understory hashes are deterministic and bounded", () => {
  it("pcg2d returns two values in [0, 1)", () => {
    const [a, b] = understoryPcg2d(12, -7, 1103);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(1);
    expect(understoryPcg2d(12, -7, 1103)).toEqual([a, b]);
  });

  it("hash is deterministic and in [0, 1)", () => {
    const value = understoryRingHash(4, 9, 9137, 307);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(1);
    expect(understoryRingHash(4, 9, 9137, 307)).toBe(value);
  });
});

describe("understory terrain gate", () => {
  const params = understoryRingAcceptParams(settings());

  it("rejects steep slopes", () => {
    expect(understoryRingTerrainGate(20, params.slopeMinY - 0.05, params)).toBe(-1);
  });

  it("rejects out-of-band heights", () => {
    expect(understoryRingTerrainGate(params.minHeightM - 1, 1, params)).toBe(-1);
    expect(understoryRingTerrainGate(params.maxHeightM + 1, 1, params)).toBe(-1);
  });

  it("rejects NaN inputs", () => {
    expect(understoryRingTerrainGate(Number.NaN, 1, params)).toBe(-1);
  });

  it("accepts a valid candidate and returns a ground weight in [0, 1]", () => {
    const ground = understoryRingTerrainGate((params.minHeightM + params.maxHeightM) / 2, 1, params);
    expect(ground).toBeGreaterThanOrEqual(0);
    expect(ground).toBeLessThanOrEqual(1);
  });
});

describe("understory ring readback resolution", () => {
  it("clamps counts to capacity and flags overflow", () => {
    const cap = 100;
    const raw = [10, 100, 150, 0, 50, 99];
    const resolved = resolveUnderstoryRingReadbackCounts(raw, cap);
    expect(resolved.groupCounts).toEqual([10, 100, 100, 0, 50, 99]);
    expect(resolved.overflowed).toBe(true);
    expect(resolved.counts[understoryRingGroupClass(2)]).toBe(100);
  });

  it("does not flag overflow when all groups are within capacity", () => {
    const resolved = resolveUnderstoryRingReadbackCounts([1, 2, 3, 4, 5, 6], 100);
    expect(resolved.overflowed).toBe(false);
  });

  it("starts empty", () => {
    const counts = emptyUnderstoryRingCounts();
    expect(Object.values(counts).every((value) => value === 0)).toBe(true);
  });
});

describe("understory ring param packing", () => {
  it("writes globals at the documented lanes", () => {
    const s = settings();
    s.seed = 4242;
    const buffer = packUnderstoryRingParams(s, {
      centerX: 100,
      centerZ: 200,
      worldCells: 1024,
      maxInstancesPerGroup: 2000,
      indexCount: 36,
    });
    expect(buffer.byteLength).toBe(UNDERSTORY_RING_PARAM_BYTES);
    const f32 = new Float32Array(buffer);
    const u32 = new Uint32Array(buffer);
    expect(f32[0]).toBeCloseTo(100);
    expect(f32[1]).toBeCloseTo(200);
    expect(f32[2]).toBeCloseTo(s.distanceM);
    expect(f32[3]).toBeCloseTo(1024);
    expect(f32[4]).toBeCloseTo(understoryRingCell(s));
    expect(f32[7]).toBeCloseTo(s.placement.slopeMinY);
    expect(u32[24]).toBe(2000);
    expect(u32[25]).toBe(understoryRingGrid(s));
    expect(u32[26]).toBe(4242);
    expect(u32[27]).toBe(UNDERSTORY_RING_GROUP_COUNT);
    expect(u32[28]).toBe(36);
  });

  it("packs one class param row per class", () => {
    const s = settings();
    const rows = packUnderstoryRingClassParams(s);
    expect(rows.length).toBe(UNDERSTORY_RING_GROUP_COUNT * UNDERSTORY_RING_CLASS_STRIDE_F32);
    UNDERSTORY_CLASSES.forEach((cls, index) => {
      const base = index * UNDERSTORY_RING_CLASS_STRIDE_F32;
      expect(rows[base + 0]).toBeCloseTo(s.classes[cls].weight);
      expect(rows[base + 1]).toBeCloseTo(s.classes[cls].density);
      expect(rows[base + 6]).toBe(s.classes[cls].enabled ? 1 : 0);
    });
  });
});
