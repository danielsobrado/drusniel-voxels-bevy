import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateSequenceSummary } from "./evaluate-sequence-summary.js";

describe("sequence summary evaluator", () => {
  it("passes a green summary artifact", () => {
    const dir = mkdtempSync(join(tmpdir(), "sequence-summary-"));
    const path = join(dir, "summary.json");
    writeFileSync(path, JSON.stringify({
      schemaVersion: 1,
      id: "static-continent-rim",
      mode: "static",
      frameCount: 8,
      gateViolations: [],
      passed: true,
    }));
    expect(evaluateSequenceSummary(path)).toMatchObject({ passed: true, violations: [] });
  });

  it("fails when passed is false or keys are missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "sequence-summary-"));
    const path = join(dir, "summary.json");
    writeFileSync(path, JSON.stringify({
      schemaVersion: 1,
      id: "broken",
      mode: "static",
      frameCount: 8,
      gateViolations: ["meanLuma 1 > 0"],
      passed: false,
    }));
    const result = evaluateSequenceSummary(path);
    expect(result.passed).toBe(false);
    expect(result.violations.some((item) => item.includes("passed is not true"))).toBe(true);
  });
});
