import { describe, expect, it } from "vitest";
import { DEFAULT_TREE_SETTINGS, parseTreeSettings } from "./tree_config.js";

describe("tree config", () => {
  it("keeps normal GPU debug readbacks disabled by default", () => {
    expect(DEFAULT_TREE_SETTINGS.gpu.readbackVisibleLists).toBe(false);
    expect(DEFAULT_TREE_SETTINGS.gpu.debugShowGpuCounts).toBe(false);
    expect(DEFAULT_TREE_SETTINGS.gpu.debugValidateAgainstCpu).toBe(false);
  });

  it("parses explicit GPU debug readback overrides", () => {
    const settings = parseTreeSettings(`
trees:
  gpu:
    readback_visible_lists: true
    debug_show_gpu_counts: true
    debug_validate_against_cpu: true
`);

    expect(settings.gpu.readbackVisibleLists).toBe(true);
    expect(settings.gpu.debugShowGpuCounts).toBe(true);
    expect(settings.gpu.debugValidateAgainstCpu).toBe(true);
  });
});
