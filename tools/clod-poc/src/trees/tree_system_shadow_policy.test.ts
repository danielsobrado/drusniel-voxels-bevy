import { describe, expect, it } from "vitest";
import { cloneTreeSettings } from "./index.js";
import { treeLodCastsShadow } from "./tree_system_shadow_policy.js";

describe("tree system shadow policy", () => {
  it("disables every LOD when shadows_max_lod is none", () => {
    const settings = cloneTreeSettings();
    settings.lod.shadowsMaxLod = "none";
    expect(treeLodCastsShadow(settings, "near")).toBe(false);
    expect(treeLodCastsShadow(settings, "mid")).toBe(false);
    expect(treeLodCastsShadow(settings, "far")).toBe(false);
    expect(treeLodCastsShadow(settings, "impostor")).toBe(false);
  });

  it("allows only LODs up to the configured max", () => {
    const settings = cloneTreeSettings();
    settings.lod.shadowsMaxLod = "mid";
    expect(treeLodCastsShadow(settings, "near")).toBe(true);
    expect(treeLodCastsShadow(settings, "mid")).toBe(true);
    expect(treeLodCastsShadow(settings, "far")).toBe(false);
    expect(treeLodCastsShadow(settings, "impostor")).toBe(false);
  });
});
