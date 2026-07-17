import { describe, expect, it } from "vitest";
import { applyContinentDefaults } from "./continent_defaults.js";

describe("continent defaults", () => {
  it("promotes the ordinary continent URL to the accepted unified profile", () => {
    const params = new URLSearchParams("scene=continent");

    expect(applyContinentDefaults(params)).toBe(true);
    expect(Object.fromEntries(params)).toMatchObject({
      continentHydrology: "1",
      heightTiles: "1",
      liveClodRootGpuMesher: "1",
      farSummaryLayout: "2",
      farClipmap: "1",
      farClipmapMode: "replace",
      farClipmapInnerRadius: "768",
    });
  });

  it("routes RPG scenes through continent while preserving benchmark identity", () => {
    for (const scene of ["rpg-village", "rpg-player-base"]) {
      const params = new URLSearchParams({ scene });

      expect(applyContinentDefaults(params)).toBe(true);
      expect(params.get("scene")).toBe("continent");
      expect(params.get("rpgDensityScene")).toBe(scene);
      expect(params.get("continentHydrology")).toBe("1");
      expect(params.get("farClipmapMode")).toBe("replace");
    }
  });

  it("preserves every explicit override", () => {
    const params = new URLSearchParams(
      "scene=continent&continentHydrology=0&heightTiles=0&liveClodRootGpuMesher=0&farSummaryLayout=1&farClipmap=0&farClipmapMode=overlay&farClipmapInnerRadius=512",
    );

    applyContinentDefaults(params);

    expect(params.toString()).toBe(
      "scene=continent&continentHydrology=0&heightTiles=0&liveClodRootGpuMesher=0&farSummaryLayout=1&farClipmap=0&farClipmapMode=overlay&farClipmapInnerRadius=512",
    );
  });

  it("does not alter other scenes", () => {
    const params = new URLSearchParams("scene=infinite-islands");
    expect(applyContinentDefaults(params)).toBe(false);
    expect(params.toString()).toBe("scene=infinite-islands");
  });
});
