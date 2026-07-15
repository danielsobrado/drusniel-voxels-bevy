import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  computeFireballPosition,
  createFireballSpellVfx,
  findFireballTerrainImpact,
} from "./fireball_spell_vfx.js";
import { defaultSpellConfig } from "./spell_config.js";

describe("fireball spell VFX", () => {
  it("follows an analytic ballistic trajectory under gravity", () => {
    const origin = new THREE.Vector3(1, 2, 3);
    const velocity = new THREE.Vector3(10, 6, -4);

    const halfSecond = computeFireballPosition(origin, velocity, 12, 0.5);
    expect(halfSecond.toArray()).toEqual([6, 3.5, 1]);

    const oneSecond = computeFireballPosition(origin, velocity, 12, 1);
    expect(oneSecond.toArray()).toEqual([11, 2, -1]);
  });

  it("sweeps the projectile radius over the whole frame without accepting distant hits", () => {
    const start = new THREE.Vector3(0, 2, 0);
    const end = new THREE.Vector3(4, -2, 0);
    const hit = findFireballTerrainImpact(start, end, 0.25, (ray) => ({
      point: ray.at(Math.sqrt(2) * 1.75, new THREE.Vector3()),
      distance: Math.sqrt(2) * 1.75,
      normal: new THREE.Vector3(0, 1, 0),
    }));
    expect(hit?.point.y).toBeCloseTo(0);

    const miss = findFireballTerrainImpact(start, new THREE.Vector3(0.1, 1.9, 0), 0.25, () => ({
      point: new THREE.Vector3(20, 0, 0),
      distance: 20,
    }));
    expect(miss).toBeNull();
  });

  it("flies, impacts terrain, fades the burst, and disposes its scene graph", () => {
    const scene = new THREE.Scene();
    let clock = 1000;
    const config = {
      ...defaultSpellConfig.fireball.vfx,
      launchSpeed: 10,
      liftSpeed: 0,
      gravity: 10,
      impactDurationMs: 600,
      trailCount: 6,
      sparkCount: 8,
    };
    const vfx = createFireballSpellVfx({
      scene,
      config,
      getSource: () => ({
        point: new THREE.Vector3(0, 2, 0),
        direction: new THREE.Vector3(1, 0, 0),
      }),
      raycastTerrain: (ray) => {
        if (ray.direction.y >= 0) return null;
        const distance = -ray.origin.y / ray.direction.y;
        return {
          point: ray.at(distance, new THREE.Vector3()),
          distance,
          normal: new THREE.Vector3(0, 1, 0),
        };
      },
      now: () => clock,
    });

    const projectile = scene.getObjectByName("fireball-spell-projectile") as THREE.Group;
    const impact = scene.getObjectByName("fireball-spell-impact") as THREE.Group;
    const trail = scene.getObjectByName("fireball-spell-trail") as THREE.InstancedMesh;
    const impactLight = scene.getObjectByName("fireball-spell-impact-light") as THREE.PointLight;
    expect(projectile.visible).toBe(false);
    expect(impact.visible).toBe(false);

    vfx.play(3000);
    expect(projectile.visible).toBe(true);

    clock = 1250;
    vfx.update(clock);
    expect(projectile.position.x).toBeCloseTo(2.5);
    expect(projectile.position.y).toBeCloseTo(1.6875);
    expect(trail.visible).toBe(true);

    clock = 1750;
    vfx.update(clock);
    expect(projectile.visible).toBe(false);
    expect(impact.visible).toBe(true);
    expect(impact.position.y).toBeCloseTo(0);
    expect(impactLight.intensity).toBeGreaterThan(0);

    clock = 2400;
    vfx.update(clock);
    expect(impact.visible).toBe(false);
    expect(impactLight.visible).toBe(false);

    vfx.dispose();
    expect(scene.getObjectByName("fireball-spell-projectile")).toBeFalsy();
    expect(scene.getObjectByName("fireball-spell-impact")).toBeFalsy();
    expect(scene.getObjectByName("fireball-spell-trail")).toBeFalsy();
  });
});
