import { describe, expect, it } from "vitest";
import { resolveWorldMode } from "./world_mode.js";

const PAGE_CELLS = 64; // chunks_per_page(4) * chunk_size(16)

function params(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

describe("resolveWorldMode", () => {
  it("treats the infinite-islands scene as infinite, disables border coast, and hands the far band to the infinite shell", () => {
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
      // infinite-islands is long-view-capable, and the clipmap renderer is disabled for `infinite-`
      // scenes, so the InfiniteFarShell — not the clipmap — owns the far band.
      longViewCapable: true,
      farClipmapRendererAllowed: false,
    });
    expect(world.mode).toBe("infinite_islands");
    expect(world.borderCoastEnabled).toBe(false);
    expect(world.farOwner).toBe("infinite_far_shell");
    // Bootstrap window and configured domain are kept distinct.
    expect(world.startupWorldCells).toBe(4 * PAGE_CELLS);
    expect(world.configuredWorldCells).toBe(16 * PAGE_CELLS);
    // Unbounded unless an ocean rim is configured.
    expect(world.proceduralWorldRadiusM).toBeNull();
  });

  it("uses the far clipmap only when it is actually allowed to render (replace mode)", () => {
    const world = resolveWorldMode({
      scene: "custom-infinite",
      searchParams: params("farClipmap=1&farClipmapMode=replace"),
      configuredWorldPages: 8,
      startupWorldPages: 8,
      pageCells: PAGE_CELLS,
      islandShapeEnabled: true,
      borderCoastConfigEnabled: true,
      oceanRim: true,
      worldRadiusM: 4096,
      longViewCapable: false,
      farClipmapRendererAllowed: true,
    });
    expect(world.mode).toBe("infinite_islands");
    expect(world.farOwner).toBe("far_clipmap");
    expect(world.proceduralWorldRadiusM).toBe(4096);
  });

  it("leaves the far band unowned for an infinite world with no far renderer", () => {
    const world = resolveWorldMode({
      scene: "custom-infinite",
      searchParams: params(""),
      configuredWorldPages: 8,
      startupWorldPages: 8,
      pageCells: PAGE_CELLS,
      islandShapeEnabled: true,
      borderCoastConfigEnabled: true,
      oceanRim: false,
      worldRadiusM: 8192,
      longViewCapable: false,
      farClipmapRendererAllowed: false,
    });
    expect(world.farOwner).toBe("none");
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
      longViewCapable: false,
      farClipmapRendererAllowed: true,
    });
    expect(world.mode).toBe("finite");
    expect(world.borderCoastEnabled).toBe(true);
    expect(world.farOwner).toBe("legacy_far_shell");
  });

  it("represents the continent as bounded streaming rather than a finite bootstrap world", () => {
    const world = resolveWorldMode({
      scene: "continent",
      searchParams: params(""),
      configuredWorldPages: 16,
      startupWorldPages: 8,
      pageCells: PAGE_CELLS,
      islandShapeEnabled: false,
      borderCoastConfigEnabled: true,
      oceanRim: true,
      worldRadiusM: 16_384,
      longViewCapable: true,
      farClipmapRendererAllowed: false,
    });
    expect(world.mode).toBe("continent");
    expect(world.proceduralWorldRadiusM).toBe(16_384);
    expect(world.borderCoastEnabled).toBe(false);
    expect(world.startupWorldCells).toBe(512);
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
      longViewCapable: false,
      farClipmapRendererAllowed: true,
    });
    expect(world.borderCoastEnabled).toBe(false);
  });
});
