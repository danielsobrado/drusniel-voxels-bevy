import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearWaterFoamDistanceEvidence,
  resolveWaterFoamDistanceEvidence,
} from "./water-foam-distance-evidence.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const path of tempRoots.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("water foam distance evidence", () => {
  it("resolves stable report and capture paths", () => {
    expect(resolveWaterFoamDistanceEvidence("shots/distance")).toEqual({
      reportPath: join("shots/distance", "report.json"),
      files: {
        bodyMask: join("shots/distance", "body-mask.png"),
        depth: join("shots/distance", "depth.png"),
        near: join("shots/distance", "foam-near.png"),
        mid: join("shots/distance", "foam-mid.png"),
        far: join("shots/distance", "foam-far.png"),
      },
    });
  });

  it("removes only previous distance evidence", () => {
    const root = mkdtempSync(join(tmpdir(), "water-foam-distance-"));
    tempRoots.push(root);
    const evidence = resolveWaterFoamDistanceEvidence(root);
    const unrelated = join(root, "keep.txt");

    writeFileSync(evidence.reportPath, "old report");
    for (const path of Object.values(evidence.files)) writeFileSync(path, "old capture");
    writeFileSync(unrelated, "keep");

    clearWaterFoamDistanceEvidence(evidence);

    expect(existsSync(evidence.reportPath)).toBe(false);
    for (const path of Object.values(evidence.files)) expect(existsSync(path)).toBe(false);
    expect(existsSync(unrelated)).toBe(true);
  });

  it("is idempotent when no previous evidence exists", () => {
    const root = mkdtempSync(join(tmpdir(), "water-foam-distance-"));
    tempRoots.push(root);
    const evidence = resolveWaterFoamDistanceEvidence(root);

    expect(() => clearWaterFoamDistanceEvidence(evidence)).not.toThrow();
  });
});
