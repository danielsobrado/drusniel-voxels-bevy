import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const computeSource = readFileSync(new URL("./compute.ts", import.meta.url), "utf8");

describe("dressing exclusion metadata", () => {
  it("publishes count, revision and overflow without readback", () => {
    expect(computeSource).toContain("persistentExclusionCount");
    expect(computeSource).toContain("persistentExclusionRevision");
    expect(computeSource).toContain("persistentExclusionOverflow");
  });
});
