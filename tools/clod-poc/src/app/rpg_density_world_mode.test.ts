import { describe, expect, it } from "vitest";
import { resolveWorldMode } from "./world_mode.js";

describe("RPG density world mode", () => {
  it.each(["rpg-village", "rpg-player-base"])("classifies %s as continent-backed", (scene) => {
    const world = resolveWorldMode({
      scene,
      searchParams: new URLSearchParams("farClipmap=1&farClipmapMode=replace"),
      configuredWorldPages: 16,
      startupWorldPages: 16,
      pageCells: 64,
      islandShapeEnabled: false,
      borderCoastConfigEnabled: true,
      oceanRim: true,
      worldRadiusM: 16_384,
      longViewCapable: true,
      farClipmapRendererAllowed: true,
    });

    expect(world.mode).toBe("continent");
    expect(world.borderCoastEnabled).toBe(false);
    expect(world.farOwner).toBe("far_clipmap");
  });
});
