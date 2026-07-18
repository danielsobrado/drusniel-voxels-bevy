import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cloneHydrologyConfig } from "../water/hydrologyConfig.js";
import { setGravelBarSettings } from "../water/gravel_bar_runtime.js";
import { composeStoneScatterShader } from "./wgsl_modules.js";

beforeEach(() => {
  setGravelBarSettings(cloneHydrologyConfig().gravelBars);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("stone gravel bar WGSL", () => {
  it("compiles disabled by default without adding bindings", () => {
    vi.stubGlobal("location", { search: "" });
    const shader = composeStoneScatterShader();
    expect(shader).toContain("const GRAVEL_BAR_ENABLED: bool = false;");
    expect(shader).toContain("fn gravel_bar_mask(");
    expect(shader).not.toContain("@binding(17)");
  });

  it("enables aliases and decodes phase while preserving body kind", () => {
    vi.stubGlobal("location", { search: "?riverGravelBars=1" });
    const shader = composeStoneScatterShader();
    expect(shader).toContain("const GRAVEL_BAR_ENABLED: bool = true;");
    expect(shader).toContain("let body_kind = u32(round(encoded_kind));");
    expect(shader).toContain("let body_phase = clamp(fract(encoded_kind) * 4.0");
    expect(shader).toContain("let special_wet_stone = underwater_cobble || gravel_bar_stone;");
    expect(shader).toContain("let variant = select(sampled_variant, 0u, special_wet_stone);");
  });
});
