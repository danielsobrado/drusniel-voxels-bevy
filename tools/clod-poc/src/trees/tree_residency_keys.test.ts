import { describe, expect, it } from "vitest";
import { treeResidencyClusterKeys } from "./tree_residency_keys.js";

describe("tree residency cluster keys", () => {
  it("uses stable CPU patch identities when patches are resident", () => {
    expect(treeResidencyClusterKeys({
      cpuPatchKeys: ["L0:2,1", "L0:1,1", "L0:2,1"],
      centerX: 0,
      centerZ: 0,
      radiusM: 128,
    })).toEqual(["tree-page:L0:1,1", "tree-page:L0:2,1"]);
  });

  it("uses world-addressed ring clusters when GPU vegetation owns residency", () => {
    const atA = treeResidencyClusterKeys({ cpuPatchKeys: [], centerX: -8_000, centerZ: 0, radiusM: 128 });
    const atB = treeResidencyClusterKeys({ cpuPatchKeys: [], centerX: 8_000, centerZ: 0, radiusM: 128 });

    expect(atA.length).toBeGreaterThan(0);
    expect(atA.some((key) => atB.includes(key))).toBe(false);
  });
});
