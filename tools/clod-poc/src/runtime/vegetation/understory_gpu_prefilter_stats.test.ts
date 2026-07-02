import { describe, expect, it } from "vitest";
import { composeUnderstoryRingShader } from "../../gpu/wgsl_modules.js";
import { emptyUnderstoryStats } from "../../understory/index.js";
import { formatUnderstoryGpuSummary } from "./vegetation_stats_presenter.js";

describe("understory GPU prefilter stats", () => {
  it("wires the compute shader through active slots", () => {
    const shader = composeUnderstoryRingShader();

    expect(shader).toContain("var<storage, read> active_slots");
    expect(shader).toContain("let slot = active_slots[id.x]");
    expect(shader).toContain("process_understory_slot(slot)");
    expect(shader).not.toContain("process_understory_slot(id.x)");
  });

  it("shows candidate reduction when the GPU ring prefilter removes slots", () => {
    const stats = {
      ...emptyUnderstoryStats(),
      gpuStatus: "ring" as const,
      gpuCandidateCount: 256,
      gpuCandidateCountBeforePrefilter: 1024,
      gpuCandidateCountAfterPrefilter: 256,
      gpuAcceptedCount: 64,
      gpuVisibleCount: 64,
      gpuDispatchMs: 1.25,
    };

    expect(formatUnderstoryGpuSummary(stats)).toContain("prefilter=256/1024");
  });
});
