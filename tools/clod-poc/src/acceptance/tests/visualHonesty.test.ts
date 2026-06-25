import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defineScreenshots, writeVisualSweepUnavailable } from "../screenshots.js";
import { runGateA1VisualSweep } from "../visualSweepGate.js";
import type { AcceptanceConfig } from "../acceptanceTypes.js";

function makeConfig(visualEnabled: boolean): AcceptanceConfig {
  return {
    outputDir: "acceptance-runs",
    world: { lod0PagesX: 4, lod0PagesZ: 4, smokeLod0PagesX: 2, smokeLod0PagesZ: 2 },
    thresholds: {
      borderPositionEpsilon: 1e-6,
      borderNormalDotMin: 0.9999,
      borderMaterialWeightDeltaMax: 1e-4,
      lod3TriangleRatioMax: 0.15,
      lowBenefitRateMax: 0.1,
      fullHierarchyBuildMsMax: 8000,
      singleNodeRebuildMsMax: 80,
      densityScarScoreMax: 0.35,
      visualHolePixelRatioMax: 0,
      visualLipPixelRatioMax: 0,
      requireMeasuredSingleNodeRebuild: false,
    },
    visual: {
      enabled: visualEnabled,
      screenshotWidth: 1920,
      screenshotHeight: 1080,
      cameraFovYDeg: 60,
      grazingAngleDeg: 7,
      crossfadeFrames: 12,
    },
    stressScenes: {
      ridgeBorder: true, cliffCorner: true, caveMouthBorder: true, thinBridge: true,
      forcedNeighborLodDeltas: [1, 2, 3], nearFieldBubbleMask: true,
    },
    logging: { level: "info" },
  };
}

describe("visual honesty", () => {
  it("visual disabled -> ratios are -1, visualSweepAvailable false", () => {
    const config = makeConfig(false);
    const result = runGateA1VisualSweep(new Map(), config, "test");
    expect(result).toBeNull();
  });

  it("visual enabled but renderer unavailable -> A1 has WARN", () => {
    const config = makeConfig(true);
    const result = runGateA1VisualSweep(new Map(), config, "test");
    expect(result).not.toBeNull();
    expect(result!.status).toBe("warn");
    expect(result!.measurements.visualHolePixelRatio).toBe(-1);
    expect(result!.measurements.visualLipPixelRatio).toBe(-1);
    expect(result!.measurements.visualSweepAvailable).toBe(false);
  });

  it("no fake .png written; writes visual_sweep_unavailable.json instead", () => {
    const config = makeConfig(false);
    const specs = defineScreenshots("test_scene", [1, 2, 3]);

    const tmpDir = join(tmpdir(), `visual-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    mkdirSync(join(tmpDir, "debug"), { recursive: true });

    writeVisualSweepUnavailable(tmpDir, config, specs);

    const debugJsonPath = join(tmpDir, "debug", "visual_sweep_unavailable.json");
    expect(existsSync(debugJsonPath)).toBe(true);
    const content = JSON.parse(readFileSync(debugJsonPath, "utf-8"));
    expect(content.visualSweepAvailable).toBe(false);
    expect(content.configuredVisualEnabled).toBe(false);
    expect(Array.isArray(content.requestedScreenshots)).toBe(true);
    expect(content.requestedScreenshots.length).toBeGreaterThan(0);

    const screenshotDir = join(tmpDir, "screenshots");
    const fakePng = join(screenshotDir, "test_scene_overview.png");
    expect(existsSync(fakePng)).toBe(false);
  });
});
