import { describe, expect, it } from "vitest";
import {
  DEFAULT_POST_PROCESS_SETTINGS,
  POSTPROCESS_SHADER_TEST_HOOKS,
} from "./postprocess.js";

describe("DEFAULT_POST_PROCESS_SETTINGS", () => {
  it("uses a neutral output pass", () => {
    expect(DEFAULT_POST_PROCESS_SETTINGS).toEqual({
      enabled: true,
      opacity: 1,
      exposure: 1,
      contrast: 1,
      saturation: 1,
      vignette: 0,
      debugMode: "output",
    });
  });
});

describe("postprocess shaders", () => {
  it("declares the copy pass uniforms", () => {
    expect(POSTPROCESS_SHADER_TEST_HOOKS.copyFragment).toContain("tDiffuse");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.copyFragment).toContain("uOpacity");
  });

  it("declares the output pass uniforms", () => {
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("tDiffuse");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("uExposure");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("uContrast");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("uSaturation");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("uVignette");
  });
});
