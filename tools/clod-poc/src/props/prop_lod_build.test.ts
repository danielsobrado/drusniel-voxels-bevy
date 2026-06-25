import { describe, expect, it } from "vitest";
import * as THREE from "three";
import customPropsYaml from "../../config/custom_props.yaml?raw";
import { parseCustomPropsConfig } from "./prop_config.js";
import { buildPropLodChain } from "./prop_lod_build.js";

describe("buildPropLodChain", () => {
  it("builds monotonic LOD triangle counts from manifest ratios", async () => {
    const settings = parseCustomPropsConfig(customPropsYaml);
    const def = settings.props.find((p) => p.id === "crate_a")!;
    const geom = new THREE.BoxGeometry(1.2, 1, 1.2);
    const chain = await buildPropLodChain(geom, def, 1);
    expect(chain.levels.length).toBe(def.lod.triangleRatios.length);
    expect(chain.levels[0]!.triangleCount).toBe(12);
    for (let i = 1; i < chain.levels.length; i++) {
      expect(chain.levels[i]!.triangleCount).toBeLessThanOrEqual(chain.levels[i - 1]!.triangleCount);
    }
  });
});
