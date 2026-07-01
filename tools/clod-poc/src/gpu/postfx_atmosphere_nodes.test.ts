import { describe, expect, it } from "vitest";
import { hillaireAerialAllowedByStageFlags } from "./postfx_atmosphere_nodes.js";

describe("postfx atmosphere nodes", () => {
  it("allows Hillaire aerial when the stage is not disabled", () => {
    expect(hillaireAerialAllowedByStageFlags("?froxels=1")).toBe(true);
  });

  it("blocks Hillaire aerial when aerial is ablated", () => {
    expect(hillaireAerialAllowedByStageFlags("?froxels=1&ablate=aerial")).toBe(false);
  });

  it("blocks Hillaire aerial through the Hillaire alias", () => {
    expect(hillaireAerialAllowedByStageFlags("?froxels=1&ablate=hillaire")).toBe(false);
  });

  it("blocks Hillaire aerial when aerial is explicitly disabled", () => {
    expect(hillaireAerialAllowedByStageFlags("?froxels=1&aerial=0")).toBe(false);
    expect(hillaireAerialAllowedByStageFlags("?froxels=1&aerialPerspective=off")).toBe(false);
  });

  it("blocks Hillaire aerial when fog is explicitly disabled", () => {
    expect(hillaireAerialAllowedByStageFlags("?froxels=1&fog=0")).toBe(false);
    expect(hillaireAerialAllowedByStageFlags("?froxels=1&haze=off")).toBe(false);
  });
});
