import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadQaConfig, runQa, testOnly, validateConfig } from "./qa.js";

describe("clod-poc QA", () => {
  it("loads the default QA config", () => {
    const config = loadQaConfig("config/qa_visual.yaml");
    expect(config.scenes[0].id).toBe("clod_poc_main_view");
  });

  it("rejects invalid probe regions", () => {
    expect(() =>
      validateConfig({
        scenes: [
          {
            id: "bad",
            checkpoint: "main",
            screenshots: [{ id: "viewport", name: "viewport" }],
            probes: [
              {
                id: "bad_region",
                type: "region_luminance",
                screenshot: "viewport",
                region: [0.9, 0.0, 0.2, 1.0],
                min: 0,
                max: 1,
              },
            ],
          },
        ],
      }),
    ).toThrow(/invalid region/);
  });

  it("evaluates timing metrics from a web summary", () => {
    const result = testOnly.evaluateTiming(
      { timing: { fail_on_threshold: true }, scenes: [] },
      { name: "main", p95_frame_ms: 18, areas: { renderer: { draw_calls: 120 } } },
      { id: "frame", area: "__frame", field: "p95_ms", max_ms: 24 },
    );
    expect(result.status).toBe("pass");
    expect(result.observed_ms).toBe(18);
  });

  it("writes a baseline-missing report for the sample summary", () => {
    const config = loadQaConfig("config/qa_visual.yaml");
    const summary = JSON.parse(readFileSync("tests/qa-sample-summary.json", "utf8"));
    const output = mkdtempSync(join(tmpdir(), "clod-qa-"));
    const report = runQa(config, summary, "tests/qa-sample-summary.json", output);
    expect(report.overall_status).toBe("baseline_missing");
    expect(readFileSync(join(output, "qa-report.md"), "utf8")).toContain("clod_poc_main_view");
  });

  it("fails when a baseline exists but diff metrics are missing", () => {
    const root = mkdtempSync(join(tmpdir(), "clod-qa-"));
    const baselineRoot = join(root, "baselines");
    mkdirSync(join(baselineRoot, "scene"), { recursive: true });
    writeFileSync(join(baselineRoot, "scene", "viewport.png"), "placeholder");
    const report = runQa(
      {
        baseline_root: baselineRoot,
        scenes: [
          {
            id: "scene",
            bench_scene: "web",
            checkpoint: "main",
            screenshots: [{ id: "viewport", name: "viewport" }],
          },
        ],
      },
      {
        scene: "web",
        checkpoints: [{ name: "main", screenshots: [{ id: "viewport", name: "viewport" }] }],
      },
      "summary.json",
      join(root, "out"),
    );

    expect(report.overall_status).toBe("fail");
    expect(report.scenes[0].screenshots[0].failure).toMatch(/diff metrics missing/);
  });

  it("reports a missing checkpoint without throwing", () => {
    const root = mkdtempSync(join(tmpdir(), "clod-qa-"));
    const report = runQa(
      {
        scenes: [
          {
            id: "scene",
            bench_scene: "web",
            checkpoint: "main",
            screenshots: [{ id: "viewport", name: "viewport" }],
          },
        ],
      },
      { scene: "web", checkpoints: [{ name: "other", screenshots: [] }] },
      "summary.json",
      join(root, "out"),
    );

    expect(report.overall_status).toBe("fail");
    expect(report.failures[0]).toMatch(/checkpoint/);
  });

  it("does not use whole-frame metrics for partial region probes", () => {
    const result = testOnly.evaluateProbe(
      {
        id: "partial",
        type: "region_luminance",
        screenshot: "viewport",
        region: [0, 0, 1, 0.5],
        min: 0,
        max: 1,
      },
      new Map([["viewport", { name: "viewport", metrics: { luminance_mean: 0.5 } }]]),
    );

    expect(result.status).toBe("fail");
    expect(result.failure).toMatch(/missing/);
  });
});
