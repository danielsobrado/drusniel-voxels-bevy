import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shaderSource = readFileSync(new URL("./dressing.compute.wgsl", import.meta.url), "utf8");

describe("dressing exclusion authority", () => {
  it("checks exclusions only for persistent candidates", () => {
    expect(shaderSource).toContain("class_data.class_meta.y == DRESSING_PERSISTENT_OWNERSHIP && dressing_identity_excluded(identity)");
    expect(shaderSource).not.toContain("DRESSING_PARENT_OWNERSHIP && dressing_identity_excluded");
  });
});
