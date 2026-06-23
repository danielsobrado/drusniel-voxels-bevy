import { describe, expect, it } from "vitest";
import { errorPx, selectCut, type SelectionParams } from "./selection.js";
import { packClodNodeInto } from "./gpu/clod_node_packing.js";
import type { ClodPageNode, PageFootprint, PageMesh } from "./types.js";

const mesh: PageMesh = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
  normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
  materials: new Float32Array([0, 0, 0]),
  indices: new Uint32Array([0, 1, 2]),
};

function node(
  id: string,
  level: number,
  footprint: PageFootprint,
  children: ClodPageNode[] = [],
  errorWorld = 0,
  minY = 0,
  maxY = 0,
): ClodPageNode {
  return {
    id,
    level,
    children,
    mesh,
    footprint,
    bounds: {
      center: [(footprint.minX + footprint.maxX) / 2, 0, (footprint.minZ + footprint.maxZ) / 2],
      radius: Math.hypot(footprint.maxX - footprint.minX, footprint.maxZ - footprint.minZ),
      minY,
      maxY,
    },
    errorWorld,
    lowBenefit: false,
  };
}

describe("selectCut 2:1 enforcement", () => {
  it("splits only edge-adjacent coarse nodes that violate the level delta", () => {
    const children = [
      node("L1:0,0", 1, { minX: 0, minZ: 0, maxX: 2, maxZ: 2 }),
      node("L1:1,0", 1, { minX: 2, minZ: 0, maxX: 4, maxZ: 2 }),
      node("L1:0,1", 1, { minX: 0, minZ: 2, maxX: 2, maxZ: 4 }),
      node("L1:1,1", 1, { minX: 2, minZ: 2, maxX: 4, maxZ: 4 }),
    ];
    const coarse = node("L2:0,0", 2, { minX: 0, minZ: 0, maxX: 4, maxZ: 4 }, children);
    const fineNeighbor = node("L0:4,0", 0, { minX: 4, minZ: 0, maxX: 5, maxZ: 1 });
    const params: SelectionParams = {
      thresholdPx: 1000,
      hysteresisMergeFactor: 1.5,
      enforce21: true,
      viewportH: 720,
      fovY: Math.PI / 3,
      camPos: [10, 10, 10],
    };

    const result = selectCut([coarse, fineNeighbor], params, { split: new Set() });

    expect(result.forcedSplits).toBe(1);
    expect(result.rendered.map((rendered) => rendered.id)).not.toContain("L2:0,0");
    expect(result.rendered.map((rendered) => rendered.id)).toContain("L0:4,0");
  });

  it("uses injected error_px values when provided", () => {
    const children = [
      node("L0:0,0", 0, { minX: 0, minZ: 0, maxX: 1, maxZ: 1 }),
      node("L0:1,0", 0, { minX: 1, minZ: 0, maxX: 2, maxZ: 1 }),
      node("L0:0,1", 0, { minX: 0, minZ: 1, maxX: 1, maxZ: 2 }),
      node("L0:1,1", 0, { minX: 1, minZ: 1, maxX: 2, maxZ: 2 }),
    ];
    const coarse = node("L1:0,0", 1, { minX: 0, minZ: 0, maxX: 2, maxZ: 2 }, children, 10_000);
    const params: SelectionParams = {
      thresholdPx: 1,
      hysteresisMergeFactor: 1.5,
      enforce21: false,
      viewportH: 720,
      fovY: Math.PI / 3,
      camPos: [10, 10, 10],
    };

    const cpu = selectCut([coarse], params, { split: new Set() });
    const injected = selectCut([coarse], params, { split: new Set() }, { errorPxLookup: () => 0 });

    expect(cpu.rendered.map((rendered) => rendered.id)).not.toContain("L1:0,0");
    expect(injected.rendered.map((rendered) => rendered.id)).toEqual(["L1:0,0"]);
  });

  it("force-splits stale edited ancestors even when their error is under budget", () => {
    const children = [
      node("L0:0,0", 0, { minX: 0, minZ: 0, maxX: 1, maxZ: 1 }),
      node("L0:1,0", 0, { minX: 1, minZ: 0, maxX: 2, maxZ: 1 }),
      node("L0:0,1", 0, { minX: 0, minZ: 1, maxX: 1, maxZ: 2 }),
      node("L0:1,1", 0, { minX: 1, minZ: 1, maxX: 2, maxZ: 2 }),
    ];
    const coarse = node("L1:0,0", 1, { minX: 0, minZ: 0, maxX: 2, maxZ: 2 }, children, 0.0001);
    const params: SelectionParams = {
      thresholdPx: 1000,
      hysteresisMergeFactor: 1.5,
      enforce21: false,
      viewportH: 720,
      fovY: Math.PI / 3,
      camPos: [10, 10, 10],
    };

    const result = selectCut(
      [coarse],
      params,
      { split: new Set() },
      { forceSplitIds: new Set(["L1:0,0"]) },
    );

    expect(result.rendered.map((rendered) => rendered.id)).toEqual(children.map((child) => child.id));
    expect(result.state.split.has("L1:0,0")).toBe(true);
  });

  it("matches CPU selection with a fake GPU error map", () => {
    const children = [
      node("L0:0,0", 0, { minX: 0, minZ: 0, maxX: 1, maxZ: 1 }),
      node("L0:1,0", 0, { minX: 1, minZ: 0, maxX: 2, maxZ: 1 }),
      node("L0:0,1", 0, { minX: 0, minZ: 1, maxX: 1, maxZ: 2 }),
      node("L0:1,1", 0, { minX: 1, minZ: 1, maxX: 2, maxZ: 2 }),
    ];
    const coarse = node("L1:0,0", 1, { minX: 0, minZ: 0, maxX: 2, maxZ: 2 }, children, 0.1);
    const params: SelectionParams = {
      thresholdPx: 1,
      hysteresisMergeFactor: 1.5,
      enforce21: true,
      viewportH: 720,
      fovY: Math.PI / 3,
      camPos: [3, 3, 3],
    };
    const fakeGpuErrors = new Map<string, number>();
    for (const n of [coarse, ...children]) fakeGpuErrors.set(n.id, errorPx(n, params));

    const cpu = selectCut([coarse], params, { split: new Set() });
    const fakeGpu = selectCut(
      [coarse],
      params,
      { split: new Set() },
      { errorPxLookup: (n) => fakeGpuErrors.get(n.id) },
    );

    expect(fakeGpu.rendered.map((rendered) => rendered.id)).toEqual(cpu.rendered.map((rendered) => rendered.id));
    expect(fakeGpu.forcedSplits).toBe(cpu.forcedSplits);
  });
});

describe("LV-1 relief split bias", () => {
  const params: SelectionParams = {
    thresholdPx: 1,
    hysteresisMergeFactor: 1.5,
    enforce21: false,
    viewportH: 720,
    fovY: Math.PI / 3,
    camPos: [10, 10, 10],
  };

  it("splits a high-relief node before a flat node at equal distance", () => {
    const footprint = { minX: 0, minZ: 0, maxX: 100, maxZ: 100 };
    const flat = node("L1:flat", 1, footprint, [], 1, 0, 0);
    const relief = node("L1:relief", 1, footprint, [], 1, 0, 80);

    const flatEpx = errorPx(flat, params);
    const reliefEpx = errorPx(relief, params);

    expect(reliefEpx).toBeGreaterThan(flatEpx);
    expect(reliefEpx).toBeGreaterThan(params.thresholdPx);
  });

  it("boost is clamped to [1, 1.8]", () => {
    const footprint = { minX: 0, minZ: 0, maxX: 100, maxZ: 100 };
    const lowRelief = node("L1:low", 1, footprint, [], 1, 0, 25);
    const maxRelief = node("L1:max", 1, footprint, [], 1, 0, 200);

    const lowEpx = errorPx(lowRelief, params);
    const maxEpx = errorPx(maxRelief, params);

    // Both should be >= base error (boost >= 1)
    expect(lowEpx).toBeGreaterThanOrEqual(1);
    // Max relief should be capped at 1.8x base
    const base = errorPx(node("L1:base", 1, footprint, [], 1, 0, 0), params);
    expect(maxEpx).toBeLessThanOrEqual(base * 1.8 + 0.001);
  });

  it("CPU errorPx agrees with a GPU-computed error using the same relief formula", () => {
    const footprint = { minX: 0, minZ: 0, maxX: 100, maxZ: 100 };
    const relief = node("L1:relief", 1, footprint, [], 1, 0, 80);

    // Pack the node and read back the exact slots the WGSL shader reads
    const packed = new Float32Array(12);
    packClodNodeInto(packed, 0, relief);

    // Read from packed slots exactly as clod_node_error_px does in clod_common.wgsl:
    //   error_level_min_y.z = minY (idx6)
    //   error_level_min_y.w = maxY (idx7)
    //   page_span_reserved.x = pageSpan (idx8)
    const packedMinY = packed[6];
    const packedMaxY = packed[7];
    const packedPageSpan = packed[8];

    // Simulate the GPU path using the packed values
    const c = relief.bounds.center;
    const d = Math.hypot(params.camPos[0] - c[0], params.camPos[1] - c[1], params.camPos[2] - c[2]);
    const dist = Math.max(0.001, d - relief.bounds.radius);
    const base = (relief.errorWorld * params.viewportH) / (2 * dist * Math.tan(params.fovY / 2));
    const gpuBoost = Math.min(1.8, Math.max(1, 1 + ((packedMaxY - packedMinY) / packedPageSpan) * 0.8));
    const gpuError = base * gpuBoost;

    const cpuError = errorPx(relief, params);
    expect(Math.abs(cpuError - gpuError)).toBeLessThan(0.001);
    // Verify the packed values match the original bounds
    expect(packedMinY).toBe(relief.bounds.minY);
    expect(packedMaxY).toBe(relief.bounds.maxY);
    expect(packedPageSpan).toBe(footprint.maxX - footprint.minX);
  });
});
