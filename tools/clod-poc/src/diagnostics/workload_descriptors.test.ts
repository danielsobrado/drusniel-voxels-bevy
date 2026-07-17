import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  measureSceneWorkloadDescriptors,
  publishWorkloadDescriptors,
  sampleWorkloadDescriptors,
  WORKLOAD_DESCRIPTOR_KEYS,
} from "./workload_descriptors.js";

function sceneWithContent(): THREE.Scene {
  const scene = new THREE.Scene();
  const geometry = new THREE.BoxGeometry();
  const opaque = new THREE.MeshStandardMaterial();
  const transparent = new THREE.MeshStandardMaterial({ transparent: true });

  const solid = new THREE.Mesh(geometry, opaque);
  solid.name = "construction-floor";
  solid.castShadow = true;
  scene.add(solid);

  const instanced = new THREE.InstancedMesh(new THREE.SphereGeometry(), transparent, 25);
  scene.add(instanced);

  const hidden = new THREE.Mesh(geometry, opaque);
  hidden.name = "construction-hidden";
  hidden.visible = false;
  scene.add(hidden);

  scene.add(new THREE.AmbientLight());
  scene.add(new THREE.PointLight());
  scene.add(new THREE.DirectionalLight());
  return scene;
}

describe("scene workload descriptors", () => {
  it("counts visible instances, construction, shadows, transparency, uniques, and lights", () => {
    const measured = measureSceneWorkloadDescriptors(sceneWithContent());
    expect(measured.visible_instances).toBe(26);
    expect(measured.construction_pieces_visible).toBe(1);
    expect(measured.shadow_casters).toBe(1);
    expect(measured.transparent_instances).toBe(25);
    expect(measured.unique_meshes).toBe(2);
    expect(measured.unique_materials).toBe(2);
    expect(measured.dynamic_lights).toBe(2);
  });

  it("estimates texture residency from unique texture dimensions", () => {
    const scene = new THREE.Scene();
    const texture = new THREE.Texture({ width: 1024, height: 1024 } as unknown as HTMLImageElement);
    const material = new THREE.MeshStandardMaterial({ map: texture });
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
    const measured = measureSceneWorkloadDescriptors(scene);
    expect(measured.texture_residency_est_mb).toBeCloseTo((1024 * 1024 * 4 * (4 / 3)) / (1024 * 1024), 1);
  });
});

describe("workload descriptor sampling", () => {
  it("fills every canonical key and combines dense scene sources", () => {
    const sample = sampleWorkloadDescriptors({
      scene: sceneWithContent(),
      counters: {
        construction_placed_meshes: 42,
        construction_colliders_active: 5,
        "props.colliders_active": 17,
        "props.gpu_candidates": 900,
        rpg_density_placed_props: 400,
      },
      triangles: 123456,
    });
    for (const key of WORKLOAD_DESCRIPTOR_KEYS) {
      expect(sample.values[key]).toBeTypeOf("number");
    }
    expect(sample.values.construction_pieces_total).toBe(42);
    expect(sample.values.construction_pieces_visible).toBe(1);
    expect(sample.values.interactive_props).toBe(400);
    expect(sample.values.colliders).toBe(22);
    expect(sample.values.vegetation_candidates).toBe(900);
    expect(sample.values.triangles).toBe(123456);
    expect(sample.values.agents_full).toBe(0);
    expect(sample.unmeasured).not.toContain("construction_pieces_visible");
    expect(sample.unmeasured).not.toContain("interactive_props");
    expect(sample.unmeasured).not.toContain("colliders");
    expect(sample.unmeasured).not.toContain("agents_full");
  });

  it("uses fallback chains in order", () => {
    const sample = sampleWorkloadDescriptors({
      scene: new THREE.Scene(),
      counters: {
        "props.candidates": 5,
        "props.interactive_total": 7,
        rpg_density_placed_props: 99,
      },
      triangles: 0,
    });
    expect(sample.values.vegetation_candidates).toBe(5);
    expect(sample.values.interactive_props).toBe(7);
    expect(sample.unmeasured).not.toContain("vegetation_candidates");
  });

  it("publishes wd_* values with measured flags", () => {
    const counters: Record<string, number> = {};
    const sample = sampleWorkloadDescriptors({
      scene: new THREE.Scene(),
      counters: { construction_placed_meshes: 3 },
      triangles: 10,
    });
    publishWorkloadDescriptors(counters, sample);
    expect(counters["wd_construction_pieces_total"]).toBe(3);
    expect(counters["wd_measured_construction_pieces_total"]).toBe(1);
    expect(counters["wd_measured_construction_pieces_visible"]).toBe(1);
    expect(counters["wd_measured_interactive_props"]).toBe(0);
    expect(counters["wd_triangles"]).toBe(10);
    expect(counters["wd_unmeasured_count"]).toBe(sample.unmeasured.length);
  });
});
