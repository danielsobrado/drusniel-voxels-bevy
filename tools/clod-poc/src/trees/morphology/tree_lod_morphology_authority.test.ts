import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const computeSource = readFileSync(
  new URL("../../gpu/shaders/tree_ring.compute.wgsl", import.meta.url),
  "utf8",
);
const impostorBaseSource = readFileSync(
  new URL("../tree_ring_impostor_node_material_base.ts", import.meta.url),
  "utf8",
);
const impostorWrapperSource = readFileSync(
  new URL("../tree_ring_impostor_node_material.ts", import.meta.url),
  "utf8",
);

describe("tree LOD morphology authority", () => {
  it("writes one accepted morphology record to visible and shadow instance buffers", () => {
    expect(computeSource).toContain("derive_tree_instance_morphology(");
    for (const field of ["morphology0", "morphology1", "morphology2"]) {
      expect(computeSource).toContain(`out_cell[base + ${field === "morphology0" ? "3" : field === "morphology1" ? "4" : "5"}u] = record.${field}`);
      expect(computeSource).toContain(`out_shadow_cell[base + ${field === "morphology0" ? "3" : field === "morphology1" ? "4" : "5"}u] = record.${field}`);
    }
  });

  it("uses that record directly for the far-to-impostor handoff", () => {
    expect(impostorBaseSource).toContain("const record = treeMorphologyRecordNodes(buffers)");
    expect(impostorBaseSource).toContain("const widthScale:");
    expect(impostorBaseSource).toContain("const flattening:");
    expect(impostorBaseSource).toContain("const retention:");
    expect(impostorWrapperSource).toContain('tree_morphology_record_authority\"] = 1');
    expect(impostorWrapperSource).toContain('tree_impostor_secondary_competition_response\"] = 0');
    expect(impostorWrapperSource).not.toContain("material.positionNode =");
    expect(impostorWrapperSource).not.toContain("material.maskNode =");
  });
});
