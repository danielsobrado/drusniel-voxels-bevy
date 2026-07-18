import { describe, expect, it } from "vitest";
import { cloneTreeSettings } from "./tree_config_defaults.js";
import {
  treeImpostorBakeCanCommit,
  treeImpostorBakeContentKey,
} from "./tree_impostor_lifecycle.js";

describe("tree impostor lifecycle", () => {
  it("invalidates atlas content only for capture-relevant settings", () => {
    const settings = cloneTreeSettings();
    const baseline = treeImpostorBakeContentKey(settings, "geometry-a");

    settings.impostors.alphaTest += 0.1;
    settings.impostors.enabled = !settings.impostors.enabled;
    settings.impostors.bakeOnStart = !settings.impostors.bakeOnStart;
    settings.impostors.swapOnBake = !settings.impostors.swapOnBake;
    settings.impostors.frameUpdateDistanceM += 1;
    expect(treeImpostorBakeContentKey(settings, "geometry-a")).toBe(baseline);

    settings.impostors.resolutionPx += 32;
    expect(treeImpostorBakeContentKey(settings, "geometry-a")).not.toBe(baseline);
    settings.impostors.resolutionPx -= 32;

    settings.species.oak.trunkHeightM += 1;
    expect(treeImpostorBakeContentKey(settings, "geometry-a")).not.toBe(baseline);
    settings.species.oak.trunkHeightM -= 1;

    expect(treeImpostorBakeContentKey(settings, "geometry-b")).not.toBe(baseline);
  });

  it("commits only the active, current, non-aborted bake", () => {
    const controller = new AbortController();
    const input = {
      signal: controller.signal,
      activeController: controller,
      controller,
      expectedContentKey: "current",
      currentContentKey: "current",
    };

    expect(treeImpostorBakeCanCommit(input)).toBe(true);
    expect(treeImpostorBakeCanCommit({
      ...input,
      activeController: new AbortController(),
    })).toBe(false);
    expect(treeImpostorBakeCanCommit({
      ...input,
      currentContentKey: "newer",
    })).toBe(false);

    controller.abort("superseded");
    expect(treeImpostorBakeCanCommit(input)).toBe(false);
  });
});
