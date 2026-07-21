import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const wrapperSource = readFileSync(new URL("../tree_ring_impostor_node_material.ts", import.meta.url), "utf8");
const baseSource = readFileSync(new URL("../tree_ring_impostor_node_material_base.ts", import.meta.url), "utf8");

describe("tree impostor competition contract", () => {
  it("uses the accepted morphology record for production geometry, health and retention", () => {
    expect(baseSource).toContain("record.morphology0.x");
    expect(baseSource).toContain("record.morphology0.w");
    expect(baseSource).toContain("record.morphology0.yz");
    expect(baseSource).toContain("record.morphology1.xy");
    expect(baseSource).toContain("record.morphology1.z");
    expect(baseSource).toContain("record.morphology1.w");
    expect(baseSource).toContain("record.morphology2.y");
    expect(baseSource).toContain("prepassNodes.set(material, { positionNode, maskNode: mask");
  });

  it("keeps accepted-canopy competition as evidence without a second impostor response", () => {
    expect(wrapperSource).toContain("textureHandle.detailTexture");
    expect(wrapperSource).toContain("resolveTreeMorphologyEvidenceMode");
    expect(wrapperSource).toContain("competitionEvidence(competition)");
    expect(wrapperSource).toContain('tree_impostor_secondary_competition_response\"] = 0');
    expect(wrapperSource).toContain('tree_morphology_record_authority\"] = 1');
    expect(wrapperSource).not.toContain("compressPosition");
    expect(wrapperSource).not.toContain("competitionKeep");
    expect(wrapperSource).not.toContain("treeMorphologyHash01Node");
    expect(wrapperSource).not.toContain("competition.mul(0.16)");
    expect(wrapperSource).not.toContain("competition.mul(0.12)");
    expect(wrapperSource).not.toContain("competition.mul(0.14)");
    expect(wrapperSource).not.toContain("prepassNodesFor:");
    expect(wrapperSource).not.toContain("createTreeImpostorAtlas");
  });
});
