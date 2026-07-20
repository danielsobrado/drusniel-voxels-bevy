import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { composeDressingGpuShader } from "../../../gpu/wgsl_modules.js";
import { dressingPersistentExclusionHash } from "./persistent_exclusion_table.js";

const computeSource = readFileSync(new URL("./compute.ts", import.meta.url), "utf8");

describe("dressing persistent exclusion GPU contract", () => {
  it("keeps CPU hash vectors locked to the WGSL constants", () => {
    expect(dressingPersistentExclusionHash({ lo: 0, hi: 0 })).toBe(0x01fce552);
    expect(dressingPersistentExclusionHash({ lo: 0xfedcba98, hi: 0x87654321 })).toBe(0x044e3bf7);
    expect(dressingPersistentExclusionHash({ lo: 0x12345678, hi: 0xf1234567 })).toBe(0x8aa1be54);

    const shader = composeDressingGpuShader();
    expect(shader).toContain("rotateLeft(identity.y, 16u)");
    expect(shader).toContain("0x7feb352du");
    expect(shader).toContain("0x846ca68bu");
  });

  it("binds exclusions as read-only storage and refreshes by revision", () => {
    expect(computeSource).toContain("const PARAM_WORDS = 24");
    expect(computeSource).toContain("storage(15, \"read-only-storage\")");
    expect(computeSource).toContain("binding: 15, resource: { buffer: this.persistentExclusions }");
    expect(computeSource).toContain("this.syncPersistentExclusions()");
    expect(computeSource).toContain("this.persistenceBridge.revision === this.lastPersistentExclusionRevision");
    expect(computeSource).toContain("const requiredStorageBuffers = 6");
    expect(computeSource).not.toMatch(/MAP_READ|mapAsync|getMappedRange/);
  });

  it("suppresses persistent generation instead of failing open on overflow", () => {
    expect(computeSource).toContain("this.persistentExclusionOverflow");
    expect(computeSource).toContain("? this.gpuLayout.persistentCandidateStart");
    expect(computeSource).toContain(": this.gpuLayout.persistentCandidateEnd");
    expect(computeSource).toContain("requiredCapacity * EXCLUSION_ENTRY_BYTES > maximumBytes");
  });
});
