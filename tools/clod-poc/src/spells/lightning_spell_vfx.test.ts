import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  computeLightningEnvelope,
  computeLightningSpellFrame,
  createLightningSpellVfx,
  generateLightningArcPoints,
} from "./lightning_spell_vfx.js";
import { defaultSpellConfig } from "./spell_config.js";

describe("lightning spell VFX", () => {
  it("computes lifetime and a fast electrical envelope", () => {
    expect(computeLightningSpellFrame(1000, 1000, 1250)).toEqual({
      active: true,
      progress: 0.25,
      timeSeconds: 0.25,
    });
    expect(computeLightningSpellFrame(1000, 1000, 2000).active).toBe(false);
    expect(computeLightningEnvelope(0)).toBe(0);
    expect(computeLightningEnvelope(0.1)).toBeGreaterThan(0.9);
    expect(computeLightningEnvelope(1)).toBe(0);
  });

  it("generates deterministic arcs while preserving exact endpoints", () => {
    const start = new THREE.Vector3(1, 2, 3);
    const end = new THREE.Vector3(-4, 5, -8);
    const first = generateLightningArcPoints(start, end, 16, 0.4, 42);
    const same = generateLightningArcPoints(start, end, 16, 0.4, 42);
    const different = generateLightningArcPoints(start, end, 16, 0.4, 43);

    expect(first).toHaveLength(17);
    expect(first[0]!.equals(start)).toBe(true);
    expect(first.at(-1)!.equals(end)).toBe(true);
    expect(first.map((point) => point.toArray())).toEqual(same.map((point) => point.toArray()));
    expect(first[8]!.distanceTo(different[8]!)).toBeGreaterThan(0.01);
  });

  it("shows, animates, hides, and disposes the arc scene graph", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 2, 5);
    camera.updateMatrixWorld();
    let clock = 1000;

    const vfx = createLightningSpellVfx({
      scene,
      config: {
        ...defaultSpellConfig.lightning.vfx,
        segmentCount: 12,
        branchCount: 3,
        sparkCount: 6,
      },
      getCamera: () => camera,
      getSource: () => ({
        point: new THREE.Vector3(0.4, 1.2, 0),
        direction: new THREE.Vector3(0, 0, -1),
      }),
      getTarget: () => ({
        point: new THREE.Vector3(0, 0.2, -8),
        normal: new THREE.Vector3(0, 1, 0),
      }),
      now: () => clock,
    });

    const core = scene.getObjectByName("lightning-spell-core") as THREE.Mesh;
    const glow = scene.getObjectByName("lightning-spell-glow") as THREE.Mesh;
    const ring = scene.getObjectByName("lightning-spell-impact-ring") as THREE.Mesh;
    const sparks = scene.getObjectByName("lightning-spell-sparks") as THREE.InstancedMesh;
    const impactLight = scene.getObjectByName("lightning-spell-impact-light") as THREE.PointLight;

    expect(core.visible).toBe(false);
    expect(glow.visible).toBe(false);
    expect(ring.visible).toBe(false);
    expect(sparks.visible).toBe(false);
    expect(impactLight.visible).toBe(false);

    vfx.play(1000);
    expect(core.visible).toBe(true);
    expect(glow.visible).toBe(true);
    expect(ring.visible).toBe(true);
    expect(sparks.visible).toBe(true);
    expect(impactLight.visible).toBe(true);

    clock = 1250;
    vfx.update(clock);
    const position = core.geometry.getAttribute("position") as THREE.BufferAttribute;
    expect(core.geometry.drawRange.count).toBeGreaterThan(0);
    expect(Array.from(position.array).every(Number.isFinite)).toBe(true);
    expect(impactLight.intensity).toBeGreaterThan(0);
    expect(ring.position.z).toBeCloseTo(-8);

    clock = 2100;
    vfx.update(clock);
    expect(core.visible).toBe(false);
    expect(glow.visible).toBe(false);
    expect(ring.visible).toBe(false);
    expect(sparks.visible).toBe(false);
    expect(impactLight.visible).toBe(false);

    vfx.dispose();
    expect(scene.getObjectByName("lightning-spell-core")).toBeFalsy();
    expect(scene.getObjectByName("lightning-spell-impact-ring")).toBeFalsy();
    expect(scene.getObjectByName("lightning-spell-sparks")).toBeFalsy();
  });
});