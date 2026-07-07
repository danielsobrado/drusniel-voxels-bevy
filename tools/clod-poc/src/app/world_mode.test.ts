import { describe, expect, it } from "vitest";
import { resolveWorldMode } from "./world_mode.js";

const PAGE_CELLS = 64; // chunks_per_page(4) * chunk_size(16)

function params(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

describe("resolveWorldMode", () => {
  it("treats the infinite-islands scene as infinite and disables border coast", () => {
    const world = resolveWorldMode({
      scene: "infinite-islands",
      searchParams: params("farClipmap=1"),
      configuredWorldPages: 16,
      startupWorldPages: 4,
      pageCells: PAGE_CELLS,
      islandShapeEnabled: true,
      borderCoastConfigEnabled: true,
      oceanRim: false,
      worldRadiusM: 8192,
    });
    expect(world.mode).toBe("infinite_islands");
    expect(world.borderCoastEnabled).toBe(false);
    expect(world.farOwner).toBe("far_clipmap");
    // Bootstrap window and configured domain are kept distinct.
    expect(world.startupWorldCells).toBe(4 * PAGE_CELLS);
    expect(world.configuredWorldCells).toBe(16 * PAGE_CELLS);
    // Unbounded unless an ocean rim is configured.
    expect(world.proceduralWorldRadiusM).toBeNull();
  });

  it("infers infinite mode from islandShape even without the scene string", () => {
    const world = resolveWorldMode({
      scene: "default",
      searchParams: params(""),
      configuredWorldPages: 8,
      startupWorldPages: 8,
      pageCells: PAGE_CELLS,
      islandShapeEnabled: true,
      borderCoastConfigEnabled: true,
      oceanRim: true,
      worldRadiusM: 4096,
    });
    expect(world.mode).toBe("infinite_islands");
    expect(world.borderCoastEnabled).toBe(false);
    expect(world.farOwner).toBe("infinite_far_shell");
    expect(world.proceduralWorldRadiusM).toBe(4096);
  });

  it("keeps finite worlds on the legacy far shell with border coast active", () => {
    const world = resolveWorldMode({
      scene: "default",
      searchParams: params(""),
      configuredWorldPages: 16,
      startupWorldPages: 16,
      pageCells: PAGE_CELLS,
      islandShapeEnabled: false,
      borderCoastConfigEnabled: true,
      oceanRim: false,
      worldRadiusM: 8192,
    });
    expect(world.mode).toBe("finite");
    expect(world.borderCoastEnabled).toBe(true);
    expect(world.farOwner).toBe("legacy_far_shell");
  });

  it("respects a disabled border-coast config in finite worlds", () => {
    const world = resolveWorldMode({
      scene: "default",
      searchParams: params(""),
      configuredWorldPages: 16,
      startupWorldPages: 16,
      pageCells: PAGE_CELLS,
      islandShapeEnabled: false,
      borderCoastConfigEnabled: false,
      oceanRim: false,
      worldRadiusM: 8192,
    });
    expect(world.borderCoastEnabled).toBe(false);
  });
});
