import { describe, expect, it } from "vitest";
import {
  injectTreeFoliageFragmentShader,
  injectTreeLodFadeFragmentShader,
  injectTreeWindShader,
} from "./tree_material.js";

const vertexShader = `
#include <common>
void main() {
  vec3 transformed = vec3(position);
  #include <begin_vertex>
}
`;

const fragmentShader = `
#include <common>
void main() {
  vec4 diffuseColor = vec4(1.0);
  #include <map_fragment>
  #include <clipping_planes_fragment>
  gl_FragColor = diffuseColor;
}
`;

describe("tree material shader injections", () => {
  it("adds deterministic per-instance shape variation before wind", () => {
    const shader = injectTreeWindShader(vertexShader);
    expect(shader).toContain("attribute float treeLodDitherRole");
    expect(shader).toContain("varying float vTreeLodDitherRole");
    expect(shader).toContain("vTreeLodDitherRole = treeLodDitherRole");
    expect(shader).toContain("treeShapePhase");
    expect(shader).toContain("treeHeightMask");
    expect(shader).toContain("transformed.xz += normalize(transformed.xz + vec2(0.001)) * treeShape * 0.34");
    expect(shader).toContain("treeSway");
  });

  it("adds complementary primary and secondary LOD dither masks", () => {
    const shader = injectTreeLodFadeFragmentShader(fragmentShader);

    expect(shader).toContain("varying float vTreeLodDitherRole");
    expect(shader).toContain("if (vTreeLodDitherRole < 0.5)");
    expect(shader).toContain("if (treeLodIgn >= vTreeLodFade) discard");
    expect(shader).toContain("if (treeLodIgn < 1.0 - vTreeLodFade) discard");
  });

  it("keeps retired foliage alpha fragment injection inert", () => {
    const shader = injectTreeFoliageFragmentShader(fragmentShader);
    expect(shader).toContain("retired alpha-card");
    expect(shader).toContain("mix(1.0, diffuseColor.a)");
    expect(shader).not.toContain("diffuseColor.a = mix");
  });
});
