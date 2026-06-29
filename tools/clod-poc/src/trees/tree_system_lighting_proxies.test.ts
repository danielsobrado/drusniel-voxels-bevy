import { describe, expect, it } from "vitest";
import {
  buildTreeLightingProxy,
  buildVisibleTreeLightingProxies,
  cloneTreeSettings,
  type TreeInstance,
} from "./index.js";

describe("tree system CPU lighting proxy helpers", () => {
  it("builds a proxy from species dimensions and instance scale", () => {
    const settings = cloneTreeSettings();
    settings.species.oak.trunkHeightM = 8;
    settings.species.oak.crownRadiusM = 4;
    const proxy = buildTreeLightingProxy(settings, instance("oak", 2, [10, 5, 20]));

    expect(proxy).toEqual({
      x: 10,
      z: 20,
      height: 32,
      scale: 2,
      crownRadius: 8,
      species: "oak",
    });
  });

  it("returns proxies for visible patches only", () => {
    const settings = cloneTreeSettings();
    const proxies = buildVisibleTreeLightingProxies(settings, [
      { visible: true, instances: [instance("oak", 1, [1, 2, 3]), instance("pine", 0.5, [4, 5, 6])] },
      { visible: false, instances: [instance("dead", 1, [7, 8, 9])] },
    ]);

    expect(proxies).toHaveLength(2);
    expect(proxies.map((proxy) => proxy.species)).toEqual(["oak", "pine"]);
    expect(proxies.map((proxy) => [proxy.x, proxy.z])).toEqual([[1, 3], [4, 6]]);
  });
});

function instance(
  species: "oak" | "pine" | "dead",
  scale: number,
  position: [number, number, number],
): TreeInstance {
  return {
    position,
    normalY: 1,
    species,
    scale,
    rotationY: 0,
  } as TreeInstance;
}
