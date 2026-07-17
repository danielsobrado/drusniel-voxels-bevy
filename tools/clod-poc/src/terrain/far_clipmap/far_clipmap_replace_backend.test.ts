import { describe, expect, it } from "vitest";
import { farClipmapRendererAllowed } from "./far_clipmap_config.js";

function query(value: string): URLSearchParams {
  return new URLSearchParams(value);
}

describe("far clipmap replace backend", () => {
  it("rejects infinite-world replacement when WebGPU ownership masks are unavailable", () => {
    expect(farClipmapRendererAllowed(
      query("scene=infinite-islands&farClipmapMode=replace"),
      false,
    )).toBe(false);
  });

  it("allows infinite-world replacement with WebGPU ownership masks", () => {
    expect(farClipmapRendererAllowed(
      query("scene=infinite-islands&farClipmapMode=replace"),
      true,
    )).toBe(true);
  });

  it("keeps finite-world clipmaps available on either renderer", () => {
    expect(farClipmapRendererAllowed(query("scene=finite"), false)).toBe(true);
  });
});
