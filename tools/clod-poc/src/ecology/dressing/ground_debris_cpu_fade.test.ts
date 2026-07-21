import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  GroundDebrisCpuResources,
  injectGroundDebrisCpuFadeShaders,
} from "./ground_debris_cpu_resources.js";
import { groundDebrisVisualProfile } from "./gpu/ground_debris_visuals.js";

const VERTEX_SOURCE = `
#include <common>
void main() {
  #include <worldpos_vertex>
}
`;

const FRAGMENT_SOURCE = `
#include <common>
void main() {
  #include <dithering_fragment>
}
`;

describe("CPU ground-debris ring-edge fade", () => {
  it("injects world-position varying and stable hash discard", () => {
    const profile = groundDebrisVisualProfile("leaf_litter")!;
    const result = injectGroundDebrisCpuFadeShaders(VERTEX_SOURCE, FRAGMENT_SOURCE, profile);
    expect(result.vertexShader).toContain("varying vec3 vGroundDebrisWorldPosition;");
    expect(result.vertexShader).toContain("vGroundDebrisWorldPosition = worldPosition.xyz;");
    expect(result.fragmentShader).toContain("groundDebrisStableHash");
    expect(result.fragmentShader).toContain("cameraPosition.xz");
    expect(result.fragmentShader).toContain("102.000 - groundDebrisDistanceM");
    expect(result.fragmentShader).toContain("102.000 - 70.000");
    expect(result.fragmentShader).toContain("if (groundDebrisDither >= groundDebrisVisibility) discard;");
  });

  it("fails loudly when Three shader anchors change", () => {
    const profile = groundDebrisVisualProfile("river_cobbles")!;
    expect(() => injectGroundDebrisCpuFadeShaders("void main() {}", FRAGMENT_SOURCE, profile))
      .toThrow("world-position vertex chunks");
    expect(() => injectGroundDebrisCpuFadeShaders(VERTEX_SOURCE, "void main() {}", profile))
      .toThrow("common and dithering fragment chunks");
  });

  it("keeps CPU debris opaque and publishes class-specific cache identity", () => {
    const scene = new THREE.Scene();
    const root = new THREE.Group();
    root.name = "ecological-dressing";
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial(),
      1,
    );
    mesh.name = "dressing:river_cobbles";
    root.add(mesh);
    scene.add(root);

    const resources = new GroundDebrisCpuResources();
    resources.apply(scene);
    const material = mesh.material as THREE.MeshStandardMaterial;
    expect(material.transparent).toBe(false);
    expect(material.depthWrite).toBe(true);
    expect(material.userData.groundDebrisCpuFade).toEqual({
      revision: 1,
      fadeStartM: 86,
      fadeEndM: 110,
    });
    expect(material.customProgramCacheKey()).toContain("ground-debris-cpu-fade|1|86|110");
    resources.dispose();
  });
});
