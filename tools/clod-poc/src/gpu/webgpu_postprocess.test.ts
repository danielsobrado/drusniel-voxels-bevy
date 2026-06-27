import { describe, expect, it } from "vitest";
import { DEFAULT_POST_PROCESS_SETTINGS } from "../environment/postprocess.js";
import { postProcessOutputGraphDirty } from "./webgpu_postprocess.js";

describe("postProcessOutputGraphDirty", () => {
  it("stays false when the frame loop re-applies the same full settings object", () => {
    const current = { ...DEFAULT_POST_PROCESS_SETTINGS };
    expect(postProcessOutputGraphDirty(current, current)).toBe(false);
  });

  it("rebuilds when enabled or debug mode actually change", () => {
    const current = { ...DEFAULT_POST_PROCESS_SETTINGS };
    expect(postProcessOutputGraphDirty(current, { enabled: false })).toBe(true);
    expect(postProcessOutputGraphDirty(current, { debugMode: "copy" })).toBe(true);
  });

  it("does not rebuild when only grading uniforms change", () => {
    const current = { ...DEFAULT_POST_PROCESS_SETTINGS };
    expect(postProcessOutputGraphDirty(current, {
      exposure: 1.2,
      contrast: 0.9,
      saturation: 1.1,
      vignette: 0.2,
      opacity: 0.8,
    })).toBe(false);
  });
});
