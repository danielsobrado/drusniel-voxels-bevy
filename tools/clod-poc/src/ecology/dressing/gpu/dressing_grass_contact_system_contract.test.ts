import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./system.ts", import.meta.url), "utf8");

describe("dressing grass-contact system contract", () => {
  it("dispatches the field after the canonical dressing compute", () => {
    const dressingDispatch = source.indexOf("compute.dispatch({");
    const contactDispatch = source.indexOf("this.dispatchGrassContact(centerX, centerZ)", dressingDispatch);
    expect(dressingDispatch).toBeGreaterThanOrEqual(0);
    expect(contactDispatch).toBeGreaterThan(dressingDispatch);
  });

  it("fails open without a gameplay readback", () => {
    expect(source).toContain("GPU field disabled after failure");
    expect(source).toContain('counters["dressing_grass_contact_readbacks"] = 0');
    expect(source).not.toContain("mapAsync");
  });
});
