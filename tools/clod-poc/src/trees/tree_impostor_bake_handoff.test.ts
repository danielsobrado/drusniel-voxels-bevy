import { describe, expect, it } from "vitest";
import { cloneTreeSettings } from "./tree_config.js";
import { treeImpostorBakeHandoffAction } from "./tree_impostor_bake_handoff.js";

describe("tree impostor bake handoff", () => {
  it("does nothing for an unsupported bake", () => {
    expect(treeImpostorBakeHandoffAction(cloneTreeSettings(), false)).toBe("none");
  });

  it("swaps live consumers when configured", () => {
    const settings = cloneTreeSettings();
    settings.impostors.swapOnBake = true;
    expect(treeImpostorBakeHandoffAction(settings, true)).toBe("swap-live");
  });

  it("rebuilds GPU consumers when live swapping is disabled", () => {
    const settings = cloneTreeSettings();
    settings.impostors.swapOnBake = false;
    settings.gpu.enabled = true;
    settings.gpu.scatterEnabled = true;
    settings.gpu.cullEnabled = true;
    settings.gpu.debugForceCpu = false;
    expect(treeImpostorBakeHandoffAction(settings, true)).toBe("rebuild-gpu");
  });

  it("rebuilds CPU consumers when live swapping is disabled", () => {
    const settings = cloneTreeSettings();
    settings.impostors.swapOnBake = false;
    settings.gpu.debugForceCpu = true;
    expect(treeImpostorBakeHandoffAction(settings, true)).toBe("rebuild-cpu");
  });
});
