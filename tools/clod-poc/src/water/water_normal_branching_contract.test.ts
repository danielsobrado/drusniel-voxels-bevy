import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  new URL("./water_node_normal_models.ts", import.meta.url),
  "utf8",
);

describe("water normal model branching contract", () => {
  it("uses real TSL control flow for expensive model selection", () => {
    expect(SOURCE).toContain("If(input.model.equal(2)");
    expect(SOURCE).toContain(".ElseIf(input.model.equal(1)");
    expect(SOURCE).toContain(".Else(() =>");
    expect(SOURCE).not.toContain("input.model.equal(2).select");
    expect(SOURCE).not.toContain("input.model.equal(1).select");
  });

  it("builds each expensive model inside its branch callback", () => {
    expect(SOURCE).toMatch(/If\(input\.model\.equal\(2\)[\s\S]*buildLegacyNormal\(input\)/);
    expect(SOURCE).toMatch(/ElseIf\(input\.model\.equal\(1\)[\s\S]*buildGlacialNormal\(input\)/);
    expect(SOURCE).toMatch(/Else\(\(\) =>[\s\S]*buildFable5InspiredNormal\(input\)/);
  });
});
