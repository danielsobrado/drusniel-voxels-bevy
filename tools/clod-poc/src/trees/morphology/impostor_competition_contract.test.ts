import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../tree_ring_impostor_node_material.ts", import.meta.url), "utf8");

describe("tree impostor competition contract", () => {
  it("uses accepted-canopy competition and exposes visual evidence without rebuilding billboards", () => {
    expect(source).toContain("textureHandle.detailTexture");
    expect(source).toContain("resolveTreeMorphologyEvidenceMode");
    expect(source).toContain("competition.mul(0.16)");
    expect(source).toContain("competition.mul(0.12)");
    expect(source).toContain("material.colorNode");
    expect(source).toContain("material.maskNode");
    expect(source).toContain("maskNode: evidenceMode");
    expect(source).not.toContain("createTreeImpostorAtlas");
  });
});
