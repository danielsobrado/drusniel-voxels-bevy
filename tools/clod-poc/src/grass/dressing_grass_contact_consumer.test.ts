import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const contactSource = readFileSync(new URL("./grass_contact_patches.ts", import.meta.url), "utf8");
const grassMaterialSource = readFileSync(new URL("../gpu/grass_node_material.ts", import.meta.url), "utf8");
const terrainSource = readFileSync(new URL("../rendering/terrain_material_webgpu.ts", import.meta.url), "utf8");

describe("dressing grass-contact consumer", () => {
  it("combines dressing with the existing stone contact authority", () => {
    expect(contactSource).toContain("dressingGrassContactInfluence(worldXZ)");
    expect(contactSource).toContain("max(stoneSuppress, dressing.suppress)");
    expect(contactSource).toContain("max(stoneTrample, dressing.trample)");
  });

  it("keeps directional splay owned by the stone contact field", () => {
    expect(contactSource).toContain("const splay: TslNode = sample.zw.mul(active)");
    expect(contactSource).not.toContain("dressing.splay");
  });

  it("routes the combined result to grass geometry and terrain tint", () => {
    expect(grassMaterialSource).toContain("grassContactPatchInfluence(vec2(aOffset.x, aOffset.z))");
    expect(grassMaterialSource).toContain("contact.suppress");
    expect(grassMaterialSource).toContain("contact.flatten");
    expect(terrainSource).toContain("applyGrassContactTerrainTint");
  });
});
