import { afterEach, describe, expect, it } from "vitest";
import { hillaireAerialAllowedByStageFlags } from "./postfx_atmosphere_nodes.js";

const ORIGINAL_LOCATION = globalThis.location;

function setSearch(search: string): void {
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { search },
  });
}

afterEach(() => {
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: ORIGINAL_LOCATION,
  });
});

describe("postfx atmosphere nodes", () => {
  it("allows Hillaire aerial when the stage is not ablated", () => {
    setSearch("?froxels=1");
    expect(hillaireAerialAllowedByStageFlags()).toBe(true);
  });

  it("blocks Hillaire aerial when aerial is ablated", () => {
    setSearch("?froxels=1&ablate=aerial");
    expect(hillaireAerialAllowedByStageFlags()).toBe(false);
  });

  it("blocks Hillaire aerial through the Hillaire alias", () => {
    setSearch("?froxels=1&ablate=hillaire");
    expect(hillaireAerialAllowedByStageFlags()).toBe(false);
  });
});
