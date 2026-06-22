import { describe, expect, it } from "vitest";
import { phase0IndirectDrawUnsupportedReason, phase0IndirectWorkgroups } from "./phase0_indirect_instancing.js";

describe("phase0 indirect instancing helpers", () => {
  it("rounds dispatch workgroups for arbitrary instance counts", () => {
    expect(phase0IndirectWorkgroups(0)).toBe(1);
    expect(phase0IndirectWorkgroups(1)).toBe(1);
    expect(phase0IndirectWorkgroups(64)).toBe(1);
    expect(phase0IndirectWorkgroups(65)).toBe(2);
  });

  it("can report whether the Three.js indirect geometry hook exists", () => {
    const reason = phase0IndirectDrawUnsupportedReason();
    expect(reason === null || reason.includes("setIndirect")).toBe(true);
  });
});
