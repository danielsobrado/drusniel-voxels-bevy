import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const directory = path.dirname(fileURLToPath(import.meta.url));
const materialSource = fs.readFileSync(path.join(directory, "ground_debris_material.ts"), "utf8");
const runtimeSource = fs.readFileSync(
  path.join(directory, "../../../environment/biome_visual_material_runtime.ts"),
  "utf8",
);

describe("ground-debris biome authority", () => {
  it("composes biome response with existing wetness and far-sun authority", () => {
    expect(materialSource).toContain("const wetness: TslNode = max(instanceWetness, biomeDew)");
    expect(materialSource).toContain("buildSunLightGpuAtlasNodes(record.positionScale.xz)");
    expect(materialSource).toContain("biome.autumn.mul(biomePolicy.autumnStrength)");
    expect(materialSource).toContain("biome.snowlineM.sub(SNOW_FADE_M)");
    expect(materialSource).toContain("roughness = mix(roughness, float(FROST_ROUGHNESS), frost)");
  });

  it("updates one shared uniform set from the existing biome material tick", () => {
    expect(runtimeSource).toContain("updateGroundDebrisBiomeState(current)");
    expect(runtimeSource).toContain("updateGroundDebrisBiomeState(next)");
    expect(runtimeSource).not.toContain("ecological-dressing\", domain");
  });

  it("adds no private environmental texture or gameplay readback", () => {
    expect(materialSource).not.toContain("new THREE.DataTexture");
    expect(materialSource).not.toContain("StorageBufferAttribute");
    expect(materialSource).not.toContain("mapAsync");
    expect(materialSource).not.toContain("readBuffer");
  });
});
