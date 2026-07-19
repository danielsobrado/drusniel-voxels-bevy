import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { computeEarthLightEnvelope, computeEarthSpellFrame, createEarthSpellVfx } from "./earth_spell_vfx.js";
import { createEarthDustNodeMaterial } from "./earth_dust_node_material.js";
import { createEarthDustParticleSystem } from "./earth_dust_particles.js";
import { defaultSpellConfig } from "./spell_config.js";

describe("earth spell VFX", () => {
  it("computes lifetime progress", () => {
    expect(computeEarthSpellFrame(1000, 1000, 1250)).toEqual({ active: true, progress: 0.25, timeSeconds: 0.25 });
    expect(computeEarthSpellFrame(1000, 1000, 2000).active).toBe(false);
  });

  it("ramps the glow envelope", () => {
    expect(computeEarthLightEnvelope(0)).toBe(0);
    expect(computeEarthLightEnvelope(0.2)).toBeGreaterThan(0.6);
    expect(computeEarthLightEnvelope(1)).toBe(0);
  });

  it("creates dust materials for transparent layered puffs", () => {
    const { material, uProgress, uTime } = createEarthDustNodeMaterial({ seed: 1, opacity: 0.5 });
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.depthTest).toBe(true);
    expect(material.side).toBe(THREE.FrontSide);
    expect(material.blending).toBe(THREE.NormalBlending);
    expect(material.toneMapped).toBe(false);
    expect(uProgress.value).toBe(0);
    expect(uTime.value).toBe(0);
  });

  it("simulates instanced dust particles", () => {
    const scene = new THREE.Scene();
    const system = createEarthDustParticleSystem({
      scene,
      config: { impactRadius: 3.2, dustRadius: 3.8 },
    });
    const particles = scene.getObjectByName("earth-spell-dust-particles") as THREE.InstancedMesh;
    expect(system.particleCount).toBeGreaterThanOrEqual(64);
    expect(particles.visible).toBe(false);

    system.spawn(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
    expect(particles.visible).toBe(true);

    system.update(0.35, 0.25);
    const matrix = new THREE.Matrix4();
    particles.getMatrixAt(8, matrix);
    expect(matrix.elements.some((value) => Math.abs(value) > 0.001)).toBe(true);

    system.hide();
    expect(particles.visible).toBe(false);
    system.dispose();
    expect(scene.getObjectByName("earth-spell-dust-particles")).toBeFalsy();
  });

  it("shows and hides scene objects", () => {
    const scene = new THREE.Scene();
    let clock = 1000;
    const point = new THREE.Vector3(4, 2, 9);
    const vfx = createEarthSpellVfx({
      scene,
      config: { ...defaultSpellConfig.earth.vfx, shardCount: 3 },
      getTarget: () => ({ point }),
      now: () => clock,
    });

    const ground = scene.getObjectByName("earth-spell-ground") as THREE.Mesh;
    const shards = scene.getObjectByName("earth-spell-shards") as THREE.InstancedMesh;
    const dust = scene.children.filter((child) => child.name.startsWith("earth-spell-dust-"));
    const particles = scene.getObjectByName("earth-spell-dust-particles") as THREE.InstancedMesh;
    const light = scene.getObjectByName("earth-spell-glow") as THREE.PointLight;
    expect(ground.visible).toBe(false);
    expect(shards.visible).toBe(false);
    expect(dust.length).toBeGreaterThanOrEqual(8);
    expect(dust.every((child) => child.visible === false)).toBe(true);
    expect(particles.visible).toBe(false);
    expect(light.visible).toBe(false);

    vfx.play(1000);
    expect(ground.visible).toBe(true);
    expect(shards.visible).toBe(true);
    expect(dust.some((child) => child.visible)).toBe(true);
    expect(particles.visible).toBe(true);
    expect(light.visible).toBe(true);

    clock = 1200;
    vfx.update(clock);
    expect(ground.position.x).toBeCloseTo(point.x);
    expect(ground.position.z).toBeCloseTo(point.z);
    expect(dust.some((child) => child.position.y > point.y)).toBe(true);
    expect(light.intensity).toBeGreaterThan(0);

    clock = 2100;
    vfx.update(clock);
    expect(ground.visible).toBe(false);
    expect(shards.visible).toBe(false);
    expect(dust.every((child) => child.visible === false)).toBe(true);
    expect(particles.visible).toBe(false);
    expect(light.visible).toBe(false);

    vfx.dispose();
    expect(scene.getObjectByName("earth-spell-ground")).toBeFalsy();
    expect(scene.children.some((child) => child.name.startsWith("earth-spell-dust-"))).toBe(false);
    expect(scene.getObjectByName("earth-spell-dust-particles")).toBeFalsy();
  });
});
