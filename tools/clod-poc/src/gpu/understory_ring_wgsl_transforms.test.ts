import { describe, expect, it } from "vitest";
import { withUnderstoryAuthorityExclusion } from "./understory_ring_wgsl_transforms.js";

const BASE_SAMPLE = "  let base_height = placement_base_ground_height(wpos.x, wpos.y);\n";

describe("understory authority exclusion transform", () => {
  it("rejects authority-masked surface samples before hydrology can replace them", () => {
    const shader = withUnderstoryAuthorityExclusion(`${BASE_SAMPLE}  let hydro = hydrologyHeight(wpos.x, wpos.y, base_height, 1.0);\n`);

    expect(shader).toContain(`${BASE_SAMPLE}  if (placement_ground_height_is_excluded(base_height)) { return; }\n`);
  });

  it("fails when the source contract changes", () => {
    expect(() => withUnderstoryAuthorityExclusion("fn main() {}"))
      .toThrow("understory shader is missing the canonical base-height sample");
  });
});
