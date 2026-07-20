import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const computeSource = readFileSync(new URL("./tree_ring_compute.ts", import.meta.url), "utf8");
const bindingSource = readFileSync(new URL("./tree_canopy_competition_binding.ts", import.meta.url), "utf8");
const bindGroupSource = readFileSync(new URL("./tree_ring_bind_group.ts", import.meta.url), "utf8");

describe("tree canonical canopy competition runtime contract", () => {
  it("refreshes the shared texture before packing and dispatch", () => {
    const refresh = computeSource.indexOf("this.canopyCompetition.refresh()");
    const pack = computeSource.indexOf("packTreeGpuRingParams(", refresh);
    const dispatch = computeSource.indexOf("this.dispatchPipeline(", pack);

    expect(refresh).toBeGreaterThan(0);
    expect(pack).toBeGreaterThan(refresh);
    expect(dispatch).toBeGreaterThan(pack);
    expect(computeSource).toContain("canopy.enabled ? 1 : 0");
  });

  it("rebuilds only the bind group when the shared texture identity changes", () => {
    expect(computeSource).toContain("if (this.canopyCompetition.refresh())");
    expect(computeSource).toContain("createTreeRingBindGroup(this.device, this.bindGroupLayout");
    expect(bindingSource).toContain("const changed = texture !== this.texture");
    expect(bindingSource).toContain("registerForestLightingGpuDevice(device)");
    expect(bindGroupSource).toContain("binding: 17");
  });

  it("keeps the authority upload-only with zero gameplay readbacks", () => {
    expect(computeSource).toContain("canopyCompetitionReadbacks: 0");
    expect(bindingSource).not.toContain("mapAsync");
    expect(bindingSource).not.toContain("GPUBufferUsage.MAP_READ");
    expect(bindGroupSource).not.toContain("MAP_READ");
  });
});
