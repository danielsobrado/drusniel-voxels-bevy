import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(new URL("./water_gui.ts", import.meta.url), "utf8");

describe("water reference preset GUI contract", () => {
  it("marks the reference look custom after manual tuning", () => {
    expect(SOURCE).toContain('reference.preset = "custom"');
    expect(SOURCE).toContain("referenceController.updateDisplay()");
    expect(SOURCE).toContain('.name("normal algorithm")\n    .onChange(rebuildCustom)');
  });
});
