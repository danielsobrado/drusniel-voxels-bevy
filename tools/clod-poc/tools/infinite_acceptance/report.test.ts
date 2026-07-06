import { describe, expect, it } from "vitest";
import { aggregatePassed, renderMarkdownReport } from "./report.js";

describe("infinite islands report helpers", () => {
  it("aggregates scene and global failures", () => {
    expect(aggregatePassed([{ passed: true }], [])).toBe(true);
    expect(aggregatePassed([{ passed: false }], [])).toBe(false);
    expect(aggregatePassed([{ passed: true }], ["failure"])).toBe(false);
  });

  it("renders the compact report table", () => {
    const markdown = renderMarkdownReport({
      passed: false,
      reportJsonPath: "acceptance-runs/infinite-islands/run/report.json",
      failures: ["walk: frame_ms_p95=9 failed: must be <= 8"],
      scenes: [{
        name: "walk",
        screenshot: "walk.png",
        stats: {},
        cache: {
          clodCacheHit: 1,
          clodCacheMiss: 0,
          clodCacheRehydrateMs: 4,
          terrainSummaryCacheHit: 1,
          terrainSummaryCacheMiss: 0,
          startupBuildWorldMs: 12.4,
          startupTerrainSummaryMs: 1.2,
          startupTotalMs: 24.8,
        },
        configuredWorldPages: 16,
        startupWorldPages: 2,
        thresholds: {
          passed: false,
          missing: [],
          failures: ["frame_ms_p95=9 failed: must be <= 8"],
          values: {
            frame_ms_p95: 9,
            frame_ms_p99: 10,
            draw_calls: 12,
            rendered_terrain_tris: 1234,
            far_shell_tris: 5678,
            missing_clod_pages_in_required_radius: 0,
            ring_boundary_holes: 0,
            live_clod_gap_holes: 0,
            clod_far_gap_holes: 0,
          },
        },
        failures: ["frame_ms_p95=9 failed: must be <= 8"],
        passed: false,
      }],
    });
    expect(markdown).toContain("| walk | 9.00 | 10.00 | n/a | n/a | n/a | 12.00 | 1234 | 5678 | 16->2 | hit | 12.4 | 1.2 | 24.8 | 0 | 0.00 | FAIL | walk.png |");
    expect(markdown).toContain("Result: FAIL");
  });
});
