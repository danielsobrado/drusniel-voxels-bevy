import { describe, expect, it } from "vitest";
import type { ClodPageNode, PageMesh } from "../../types.js";
import {
  DEFAULT_STREAMED_PAGE_BOUNDS_GUARD_CONFIG,
  streamedPageBoundsGuardConfigFromParams,
  validateStreamedPageBounds,
  type StreamedPageBoundsGuardConfig,
} from "./streamed_page_bounds_guard.js";

const CONFIG: StreamedPageBoundsGuardConfig = {
  ...DEFAULT_STREAMED_PAGE_BOUNDS_GUARD_CONFIG,
  enabled: true,
  marginXZ: 2,
  centroidMarginXZ: 2,
  maxExtentFootprintRatio: 1.25,
  boundsMismatchMarginXZ: 2,
  boundsYMargin: 64,
  maxAbsY: 4096,
};

function meshFromPositions(positions: readonly number[], indices: readonly number[] = [0, 1, 2, 2, 1, 3]): PageMesh {
  const vertices = positions.length / 3;
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(Array.from({ length: vertices }, () => [0, 1, 0]).flat()),
    paintSlots: new Float32Array(vertices),
    materialWeights: new Float32Array(vertices * 4),
    materialWeightStride: 4,
    indices: new Uint32Array(indices),
  };
}

function square(minX: number, minZ: number, size: number, y = 1): PageMesh {
  return meshFromPositions([
    minX, y, minZ,
    minX + size, y, minZ,
    minX, y, minZ + size,
    minX + size, y, minZ + size,
  ]);
}

function node(mesh: PageMesh, minX = 64, minZ = 128, size = 64, minY = 0, maxY = 128): ClodPageNode {
  return {
    id: "L0:1,2",
    revision: 1,
    level: 0,
    children: [],
    mesh,
    footprint: { minX, minZ, maxX: minX + size, maxZ: minZ + size },
    bounds: { center: [minX + size / 2, (minY + maxY) / 2, minZ + size / 2], radius: size, minY, maxY },
    errorWorld: 0,
    lowBenefit: false,
  };
}

describe("streamedPageBoundsGuardConfigFromParams", () => {
  it("uses numeric defaults for missing and blank query params", () => {
    const missing = streamedPageBoundsGuardConfigFromParams(new URLSearchParams("liveClodRootBoundsGuard=1"));
    expect(missing.marginXZ).toBe(DEFAULT_STREAMED_PAGE_BOUNDS_GUARD_CONFIG.marginXZ);
    expect(missing.centroidMarginXZ).toBe(DEFAULT_STREAMED_PAGE_BOUNDS_GUARD_CONFIG.centroidMarginXZ);
    expect(missing.maxExtentFootprintRatio).toBe(DEFAULT_STREAMED_PAGE_BOUNDS_GUARD_CONFIG.maxExtentFootprintRatio);
    expect(missing.boundsMismatchMarginXZ).toBe(DEFAULT_STREAMED_PAGE_BOUNDS_GUARD_CONFIG.boundsMismatchMarginXZ);
    expect(missing.boundsYMargin).toBe(DEFAULT_STREAMED_PAGE_BOUNDS_GUARD_CONFIG.boundsYMargin);
    expect(missing.maxAbsY).toBe(DEFAULT_STREAMED_PAGE_BOUNDS_GUARD_CONFIG.maxAbsY);

    const blank = streamedPageBoundsGuardConfigFromParams(new URLSearchParams(
      "liveClodRootBoundsGuardMarginXZ=&liveClodRootBoundsGuardMaxExtentRatio= ",
    ));
    expect(blank.marginXZ).toBe(DEFAULT_STREAMED_PAGE_BOUNDS_GUARD_CONFIG.marginXZ);
    expect(blank.maxExtentFootprintRatio).toBe(DEFAULT_STREAMED_PAGE_BOUNDS_GUARD_CONFIG.maxExtentFootprintRatio);
  });

  it("allows explicit zero only for non-negative numeric params", () => {
    const config = streamedPageBoundsGuardConfigFromParams(new URLSearchParams(
      "liveClodRootBoundsGuardMarginXZ=0&liveClodRootBoundsGuardMaxExtentRatio=0",
    ));
    expect(config.marginXZ).toBe(0);
    expect(config.maxExtentFootprintRatio).toBe(DEFAULT_STREAMED_PAGE_BOUNDS_GUARD_CONFIG.maxExtentFootprintRatio);
  });
});

describe("validateStreamedPageBounds", () => {
  it("passes a valid world-space node", () => {
    const result = validateStreamedPageBounds(node(square(72, 136, 40)), 16, CONFIG);
    expect(result.ok).toBe(true);
  });

  it("fails a far page whose mesh is still local-origin", () => {
    const result = validateStreamedPageBounds(node(square(0, 0, 32)), 16, CONFIG);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("xz_out_of_bounds");
  });

  it("fails a double-translated world mesh", () => {
    const result = validateStreamedPageBounds(node(square(136, 264, 32)), 16, CONFIG);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("xz_out_of_bounds");
  });

  it("fails NaN and Infinity positions", () => {
    expect(validateStreamedPageBounds(node(meshFromPositions([64, 0, 128, NaN, 0, 128, 64, 0, 129], [0, 1, 2])), 16, CONFIG).reason).toBe("non_finite_position");
    expect(validateStreamedPageBounds(node(meshFromPositions([64, 0, 128, Infinity, 0, 128, 64, 0, 129], [0, 1, 2])), 16, CONFIG).reason).toBe("non_finite_position");
  });

  it("fails an index out of range", () => {
    const result = validateStreamedPageBounds(node(meshFromPositions([64, 0, 128, 65, 0, 128, 64, 0, 129], [0, 1, 3])), 16, CONFIG);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("index_out_of_range");
  });

  it("allows a border/skirt vertex within margin", () => {
    const result = validateStreamedPageBounds(node(square(62.5, 126.5, 65)), 16, CONFIG);
    expect(result.ok).toBe(true);
  });

  it("fails a stretched strip by extent", () => {
    const result = validateStreamedPageBounds(node(meshFromPositions([
      64, 0, 128,
      150, 0, 128,
      64, 0, 129,
      150, 0, 129,
    ])), 16, CONFIG);
    expect(result.ok).toBe(false);
    expect(["xz_out_of_bounds", "xz_extent_too_large"]).toContain(result.reason);
  });

  it("allows high mountain Y when X/Z and bounds agree", () => {
    const highMesh = square(72, 136, 40, 900);
    const result = validateStreamedPageBounds(node(highMesh, 64, 128, 64, 800, 1000), 16, CONFIG);
    expect(result.ok).toBe(true);
  });

  it("fails absurd Y", () => {
    const result = validateStreamedPageBounds(node(square(72, 136, 40, 5000), 64, 128, 64, 0, 128), 16, CONFIG);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("y_out_of_bounds");
  });
});
