import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  computeSpellFrame,
  computeSpellLightEnvelope,
  createSpellPoseResolver,
  createSpellVfxController,
  orientFireJet,
  type SpellVfxMeshConfig,
} from "./spell_vfx_controller.js";
import { createFireNodeMaterial } from "./fire_node_material.js";
import { createWaterNodeMaterial } from "./water_node_material.js";
import { createAirNodeMaterial } from "./air_node_material.js";
import { createEarthNodeMaterial } from "./earth_node_material.js";
import { defaultSpellConfig, type EarthSpellVfxConfig } from "./spell_config.js";

const meshCfg: SpellVfxMeshConfig = {
  worldWidth: 1.8,
  worldHeight: 3,
  flameScale: 1,
  handForwardM: 0,
  handRightM: 0,
  handUpM: 0,
  glowColor: [1, 0.5, 0.2],
  glowIntensity: 2.5,
  glowDistance: 7,
  glowDecay: 2,
  glowLocalYRatio: 0.35,
};

const earthCfg: EarthSpellVfxConfig = {
  ...defaultSpellConfig.earth.vfx,
  shardCount: 4,
  shardLifetimeMs: 800,
};

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

describe("computeSpellLightEnvelope", () => {
  it("ramps in, holds, and fades out", () => {
    expect(computeSpellLightEnvelope(0)).toBe(0);
    expect(computeSpellLightEnvelope(0.06)).toBeGreaterThan(0.4);
    expect(computeSpellLightEnvelope(0.2)).toBeGreaterThan(0.8);
    expect(computeSpellLightEnvelope(0.72)).toBeGreaterThan(0.8);
    expect(computeSpellLightEnvelope(1)).toBe(0);
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
    ["air", createAirNodeMaterial, THREE.AdditiveBlending],
    ["earth", createEarthNodeMaterial, THREE.NormalBlending],
  ] as const)("%s blends correctly without writing depth", (_name, factory, blending) => {
    const { material, uProgress, uTime } = factory();
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.depthTest).toBe(true);
    expect(material.side).toBe(THREE.FrontSide);
    expect(material.blending).toBe(blending);
    expect(material.toneMapped).toBe(false);
    expect(uProgress.value).toBe(0);
    expect(uTime.value).toBe(0);
  });
});

describe("createSpellPoseResolver", () => {
  const vfx = { ...defaultSpellConfig.fire.vfx, handForwardM: 0.5, handRightM: 0.35, handUpM: -0.35 };

  it("places the hand offset from the eye and aims the jet along the look direction", () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 0);
    camera.updateMatrixWorld();
    const pose = createSpellPoseResolver({ camera, vfx })();
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
    camera.updateMatrixWorld();
    let clock = 1000;
    const controller = createSpellVfxController({
      scene,
      getCamera: () => camera,
      fire: meshCfg,
      water: meshCfg,
      air: meshCfg,
      earth: earthCfg,
      getEarthTarget: () => ({ point: new THREE.Vector3(1, 2, 3) }),
      now: () => clock,
    });

    const fireMesh = scene.getObjectByName("fire-spell") as THREE.Mesh;
    const fireLight = scene.getObjectByName("fire-spell-glow") as THREE.PointLight;
    expect(scene.getObjectByName("fire-spell-fallback")).toBeFalsy();
    expect(fireMesh).toBeTruthy();
    expect(fireMesh.visible).toBe(false);
    expect(fireLight.visible).toBe(false);
    expect(fireLight.color.r).toBeCloseTo(meshCfg.glowColor[0]);

    controller.playFire(2000);
    expect(fireMesh.visible).toBe(true);
    expect(fireLight.visible).toBe(true);

    clock = 2000;
    controller.update(clock);
    expect(fireMesh.visible).toBe(true);
    expect(fireLight.intensity).toBeGreaterThan(0);
    expect(fireMesh.position.x).toBeCloseTo(10);
    expect(fireMesh.position.y).toBeCloseTo(5);
    expect(fireMesh.position.z).toBeCloseTo(0);
    const tipAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(fireMesh.quaternion);
    expect(tipAxis.z).toBeCloseTo(-1);

    clock = 3500;
    controller.update(clock);
    expect(fireMesh.visible).toBe(false);
    expect(fireLight.visible).toBe(false);
    expect(fireLight.intensity).toBe(0);

    controller.dispose();
    expect(scene.getObjectByName("fire-spell")).toBeFalsy();
    expect(scene.getObjectByName("air-spell")).toBeFalsy();
  });

  it("plays air and uses its own hand offset", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 0);
    camera.updateMatrixWorld();
    let clock = 1000;
    const controller = createSpellVfxController({
      scene,
      getCamera: () => camera,
      fire: meshCfg,
      water: meshCfg,
      air: { ...meshCfg, handForwardM: 0.5, handRightM: 2, handUpM: -1, glowLocalYRatio: 0.5 },
      earth: earthCfg,
      getEarthTarget: () => ({ point: new THREE.Vector3(1, 2, 3) }),
      now: () => clock,
    });

    const airMesh = scene.getObjectByName("air-spell") as THREE.Mesh;
    const airLight = scene.getObjectByName("air-spell-glow") as THREE.PointLight;
    expect(airMesh).toBeTruthy();
    expect(airMesh.visible).toBe(false);
    expect(airLight.visible).toBe(false);
    expect(airLight.position.y).toBeCloseTo(meshCfg.worldHeight * 0.5);

    controller.playAir(1000);
    expect(airMesh.visible).toBe(true);
    expect(airLight.visible).toBe(true);

    clock = 1200;
    controller.update(clock);
    expect(airMesh.position.x).toBeCloseTo(2);
    expect(airMesh.position.y).toBeCloseTo(-1);
    expect(airMesh.position.z).toBeCloseTo(-0.5);
    expect(airLight.intensity).toBeGreaterThan(0);

    clock = 2100;
    controller.update(clock);
    expect(airMesh.visible).toBe(false);
    expect(airLight.visible).toBe(false);

    controller.dispose();
  });

  it("plays earth at the supplied terrain target", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    let clock = 1000;
    const target = new THREE.Vector3(7, 3, 11);
    const controller = createSpellVfxController({
      scene,
      getCamera: () => camera,
      fire: meshCfg,
      water: meshCfg,
      air: meshCfg,
      earth: earthCfg,
      getEarthTarget: () => ({ point: target }),
      now: () => clock,
    });

    const ground = scene.getObjectByName("earth-spell-ground") as THREE.Mesh;
    const light = scene.getObjectByName("earth-spell-glow") as THREE.PointLight;
    expect(ground.visible).toBe(false);
    expect(light.visible).toBe(false);

    controller.playEarth(1000);
    expect(ground.visible).toBe(true);
    expect(light.visible).toBe(true);

    clock = 1200;
    controller.update(clock);
    expect(ground.position.x).toBeCloseTo(target.x);
    expect(ground.position.z).toBeCloseTo(target.z);
    expect(light.intensity).toBeGreaterThan(0);

    clock = 2200;
    controller.update(clock);
    expect(ground.visible).toBe(false);
    expect(light.visible).toBe(false);

    controller.dispose();
    expect(scene.getObjectByName("earth-spell-ground")).toBeFalsy();
  });
});
