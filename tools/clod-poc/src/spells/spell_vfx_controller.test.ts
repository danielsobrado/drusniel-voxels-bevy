import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  computeSpellFrame,
  createSpellPoseResolver,
  createSpellVfxController,
  orientFireJet,
  type SpellVfxMeshConfig,
} from "./spell_vfx_controller.js";
import { createFireNodeMaterial } from "./fire_node_material.js";
import { createWaterNodeMaterial } from "./water_node_material.js";
import { defaultSpellConfig } from "./spell_config.js";

const meshCfg: SpellVfxMeshConfig = { worldWidth: 1.8, worldHeight: 3, flameScale: 1 };

describe("computeSpellFrame", () => {
  it("tracks progress and elapsed seconds over the cast", () => {
    expect(computeSpellFrame(1000, 2000, 1000)).toMatchObject({ active: true, progress: 0 });
    const mid = computeSpellFrame(1000, 2000, 2000);
    expect(mid.progress).toBeCloseTo(0.5);
    expect(mid.timeSeconds).toBeCloseTo(1);
    expect(mid.active).toBe(true);
  });

  it("becomes inactive once the duration elapses", () => {
    expect(computeSpellFrame(1000, 2000, 3000).active).toBe(false);
    expect(computeSpellFrame(1000, 2000, 3500).active).toBe(false);
  });
});

describe("orientFireJet", () => {
  it("aligns the billboard's base->tip axis with the jet direction", () => {
    const q = orientFireJet(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(2, 0, 5),
    );
    const tipAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    expect(tipAxis.x).toBeCloseTo(0);
    expect(tipAxis.y).toBeCloseTo(0);
    expect(tipAxis.z).toBeCloseTo(-1);
  });

  it("stays finite when the camera sits on the jet axis (degenerate roll)", () => {
    const q = orientFireJet(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0, 0, 5),
    );
    const tipAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    expect(tipAxis.z).toBeCloseTo(-1);
    expect(Number.isNaN(q.x + q.y + q.z + q.w)).toBe(false);
  });
});

describe("spell node materials", () => {
  it.each([
    ["fire", createFireNodeMaterial, THREE.AdditiveBlending],
    ["water", createWaterNodeMaterial, THREE.NormalBlending],
  ] as const)("%s blends additively/normally without writing depth", (_name, factory, blending) => {
    const { material, uProgress, uTime } = factory();
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.depthTest).toBe(true);
    expect(material.side).toBe(THREE.DoubleSide);
    expect(material.blending).toBe(blending);
    expect(material.toneMapped).toBe(false);
    expect(uProgress.value).toBe(0);
    expect(uTime.value).toBe(0);
  });
});

describe("createSpellPoseResolver", () => {
  const vfx = { ...defaultSpellConfig.fire.vfx, handForwardM: 0.5, handRightM: 0.35, handUpM: -0.35 };

  it("places the hand offset from the eye and aims the jet along the look direction", () => {
    const camera = new THREE.PerspectiveCamera(); // default look direction is -Z
    camera.position.set(0, 0, 0);
    camera.updateMatrixWorld();
    const pose = createSpellPoseResolver({ camera, vfx })();
    // forward 0.5 (-Z), right 0.35 (+X), down 0.35 (-Y)
    expect(pose.base.x).toBeCloseTo(0.35);
    expect(pose.base.y).toBeCloseTo(-0.35);
    expect(pose.base.z).toBeCloseTo(-0.5);
    expect(pose.dir.x).toBeCloseTo(0);
    expect(pose.dir.y).toBeCloseTo(0);
    expect(pose.dir.z).toBeCloseTo(-1);
  });
});

describe("createSpellVfxController", () => {
  it("shows, positions/orients, then hides the fire billboard over its lifetime", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(10, 5, 0);
    const base = new THREE.Vector3(0, 1, 0);
    const dir = new THREE.Vector3(0, 0, -1);
    let clock = 1000;
    const controller = createSpellVfxController({
      scene,
      getCamera: () => camera,
      getPose: () => ({ base, dir }),
      fire: meshCfg,
      water: meshCfg,
      now: () => clock,
    });

    const fireMesh = scene.getObjectByName("fire-spell") as THREE.Mesh;
    expect(fireMesh).toBeTruthy();
    expect(fireMesh.visible).toBe(false);

    controller.playFire(2000); // startMs = 1000
    expect(fireMesh.visible).toBe(true);

    clock = 2000; // mid cast
    controller.update(clock);
    expect(fireMesh.visible).toBe(true);
    expect(fireMesh.position.x).toBeCloseTo(0);
    expect(fireMesh.position.y).toBeCloseTo(1);
    expect(fireMesh.position.z).toBeCloseTo(0);
    // Local +Y (base->tip) must follow the jet direction.
    const tipAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(fireMesh.quaternion);
    expect(tipAxis.z).toBeCloseTo(-1);

    clock = 3500; // past the cast duration
    controller.update(clock);
    expect(fireMesh.visible).toBe(false);

    controller.dispose();
    expect(scene.getObjectByName("fire-spell")).toBeFalsy();
  });
});
