import { describe, expect, it } from "vitest";
import { parseClodRuntimeQueryFlags, parseSceneQueryFlags } from "./query_context.js";

describe("bootstrap scene query flags", () => {
  it("reads long-view metadata from the scene registry", () => {
    const flags = parseSceneQueryFlags(new URLSearchParams("scene=infinite-islands"));

    expect(flags.queryLongViewScene).toBe(true);
    expect(flags.queryGrassPerfScene).toBe(false);
  });

  it("keeps explicit tree perf query compatibility", () => {
    const flags = parseSceneQueryFlags(new URLSearchParams("treesPerf=1"));

    expect(flags.queryTreePerfScene).toBe(true);
  });

  it("preserves webgpu parity query casing", () => {
    expect(parseClodRuntimeQueryFlags(new URLSearchParams("webgpuParity=1")).queryWebGpuParity).toBe(true);
    expect(parseClodRuntimeQueryFlags(new URLSearchParams("webGpuParity=1")).queryWebGpuParity).toBe(false);
  });
});
