import { describe, expect, it } from "vitest";
import { injectTreeFoliageFragmentShader, injectTreeWindShader } from "./tree_material.js";

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
  gl_FragColor = diffuseColor;
}
`;

describe("tree material shader injections", () => {
  it("adds deterministic per-instance shape variation before wind", () => {
    const shader = injectTreeWindShader(vertexShader);
    expect(shader).toContain("treeShapePhase");
    expect(shader).toContain("treeHeightMask");
    expect(shader).toContain("transformed.xz += normalize(transformed.xz + vec2(0.001)) * treeShape * 0.34");
    expect(shader).toContain("treeSway");
  });

  it("keeps retired foliage alpha fragment injection inert", () => {
    const shader = injectTreeFoliageFragmentShader(fragmentShader);
    expect(shader).toContain("retired alpha-card");
    expect(shader).toContain("mix(1.0, diffuseColor.a)");
    expect(shader).not.toContain("diffuseColor.a = mix");
  });
});
