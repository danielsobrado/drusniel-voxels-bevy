import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { GrassController } from "../runtime/vegetation/grass_controller.js";
import type { TerrainMaterialController } from "../terrain/material/terrain_material_controller.js";
import { installBiomeVisualMaterialRouting } from "./biome_visual_material_routing.js";

const GRASS_FRAGMENT_SHADER = `
precision highp float;
varying vec3 vWorldNormal;
void main() {
    vec3 base = vec3(0.02, 0.06, 0.01);
    vec3 mid = vec3(0.08, 0.17, 0.04);
    vec3 color = mix(base, mid, 0.5);
    vec3 n = normalize(vWorldNormal);
    gl_FragColor = vec4(color * max(n.y, 0.0), 1.0);
}
`;

const TREE_FRAGMENT_SHADER = `
precision highp float;
void main() {
    gl_FragColor = vec4(0.08, 0.16, 0.05, 1.0);
}
`;

function createGrassMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ fragmentShader: GRASS_FRAGMENT_SHADER });
}

function createGrassController(): GrassController {
  return {
    update: () => undefined,
  } as unknown as GrassController;
}

function createTerrainController(): TerrainMaterialController {
  return {
    materials: new Set(),
    makeTerrainMaterial: () => {
      throw new Error("not used in this test");
    },
    configureChunkMaterial: () => undefined,
  } as unknown as TerrainMaterialController;
}

function occurrences(source: string, value: string): number {
  return source.split(value).length - 1;
}

describe("biome visual material runtime", () => {
  it("deduplicates, handles streamed materials, and routes the far canopy", () => {
    const scene = new THREE.Scene();
    const root = new THREE.Group();
    root.name = "grass";
    scene.add(root);

    const shared = createGrassMaterial();
    root.add(
      new THREE.Mesh(new THREE.BufferGeometry(), shared),
      new THREE.Mesh(new THREE.BufferGeometry(), shared),
    );

    const farCanopyMaterial = new THREE.ShaderMaterial({ fragmentShader: TREE_FRAGMENT_SHADER });
    const farCanopy = new THREE.Mesh(new THREE.BufferGeometry(), farCanopyMaterial);
    farCanopy.userData.canopyTextureSetRevision = 1;
    scene.add(farCanopy);

    const grassController = createGrassController();
    installBiomeVisualMaterialRouting({
      scene,
      materialController: createTerrainController(),
      grassController,
    });

    expect(occurrences(shared.fragmentShader, "vec3 biomeVisualGrassColor")).toBe(1);
    expect(occurrences(farCanopyMaterial.fragmentShader, "vec3 biomeVisualFoliageColor")).toBe(1);

    const center = new THREE.Vector3();
    const camera = new THREE.Camera();
    shared.dispose();
    for (let frame = 0; frame < 121; frame += 1) {
      grassController.update(0, center, camera);
    }
    expect(occurrences(shared.fragmentShader, "vec3 biomeVisualGrassColor")).toBe(1);

    const streamed = createGrassMaterial();
    root.add(new THREE.Mesh(new THREE.BufferGeometry(), streamed));
    for (let frame = 0; frame < 121; frame += 1) {
      grassController.update(0, center, camera);
    }

    expect(occurrences(streamed.fragmentShader, "vec3 biomeVisualGrassColor")).toBe(1);
  });
});
