import { describe, expect, it } from "vitest";
import { hillaireAerialAllowedByStageFlags } from "./postfx_atmosphere_nodes.js";

describe("postfx atmosphere nodes", () => {
  it("allows Hillaire aerial when the stage is not ablated", () => {
    expect(hillaireAerialAllowedByStageFlags("?froxels=1")).toBe(true);
  });

  it("blocks Hillaire aerial when aerial is ablated", () => {
    expect(hillaireAerialAllowedByStageFlags("?froxels=1&ablate=aerial")).toBe(false);
  });

  it("blocks Hillaire aerial through the Hillaire alias", () => {
    expect(hillaireAerialAllowedByStageFlags("?froxels=1&ablate=hillaire")).toBe(false);
  });
});
