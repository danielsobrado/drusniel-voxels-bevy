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
