import { describe, expect, it } from "vitest";
import { buildQaAffectedPlan, globMatches, loadQaPathOwnership } from "./path_ownership.js";

describe("change-aware QA planning", () => {
  it("matches recursive and filename wildcards", () => {
    expect(globMatches("tools/clod-poc/src/water/**", "tools/clod-poc/src/water/hydrology.ts")).toBe(true);
    expect(globMatches("tools/clod-poc/src/gpu/postfx_*.ts", "tools/clod-poc/src/gpu/postfx_clouds.ts")).toBe(true);
    expect(globMatches("tools/clod-poc/src/water/**", "tools/clod-poc/src/trees/tree.ts")).toBe(false);
  });

  it("selects smoke plus only affected subsystem scripts", () => {
    const config = loadQaPathOwnership("config/qa_path_ownership.yaml");
    const plan = buildQaAffectedPlan(config, ["tools/clod-poc/src/water/hydrology.ts"]);
    expect(plan.battery).toBe("clod-smoke");
    expect(plan.scripts).toEqual(["water:verify"]);
    expect(plan.matchedRules).toEqual(["water"]);
  });

  it("escalates renderer foundation changes to full", () => {
    const config = loadQaPathOwnership("config/qa_path_ownership.yaml");
    const plan = buildQaAffectedPlan(config, ["tools/clod-poc/src/app/clod_frame_loop.ts"]);
    expect(plan.battery).toBe("clod-full");
  });
});
