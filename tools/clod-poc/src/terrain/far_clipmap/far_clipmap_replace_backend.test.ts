import { describe, expect, it } from "vitest";
import { farClipmapRendererAllowed } from "./far_clipmap_config.js";

function query(value: string): URLSearchParams {
  return new URLSearchParams(value);
}

describe("far clipmap replace backend", () => {
  it("rejects replacement when WebGPU ownership masks are unavailable", () => {
    expect(farClipmapRendererAllowed(
      query("scene=infinite-islands&farClipmapMode=replace"),
      false,
    )).toBe(false);
    expect(farClipmapRendererAllowed(
      query("scene=continent&farClipmapMode=replace"),
      false,
    )).toBe(false);
  });

  it("allows replacement with WebGPU ownership masks", () => {
    expect(farClipmapRendererAllowed(
      query("scene=infinite-islands&farClipmapMode=replace"),
      true,
    )).toBe(true);
    expect(farClipmapRendererAllowed(
      query("scene=continent&farClipmapMode=replace"),
      true,
    )).toBe(true);
  });

  it("keeps non-replacement finite-world clipmaps available on either renderer", () => {
    expect(farClipmapRendererAllowed(query("scene=finite"), false)).toBe(true);
  });
});
