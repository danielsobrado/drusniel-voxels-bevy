import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { FloatingOriginController, resolveFloatingOriginEnabled } from "./floating_origin.js";
import type { PlayerController } from "../player_controller.js";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

function controls(target = new THREE.Vector3()): OrbitControls {
  return {
    target,
    update: () => undefined,
  } as unknown as OrbitControls;
}

function playerAt(x: number, z: number): PlayerController {
  return {
    position: new THREE.Vector3(x, 2, z),
    lastSafePosition: new THREE.Vector3(x, 2, z),
  } as unknown as PlayerController;
}

describe("FloatingOriginController", () => {
  it("stays disabled for bounded worlds even when requested", () => {
    expect(resolveFloatingOriginEnabled({ enabled: true, snapMeters: 1024, unboundedWorld: false })).toBe(false);
  });

  it("allows an explicit bounded-world A/B without changing the default", () => {
    expect(resolveFloatingOriginEnabled({
      enabled: true,
      snapMeters: 1024,
      unboundedWorld: false,
      allowBoundedWorld: true,
    })).toBe(true);
  });

  it("rebases render coordinates and keeps world camera coordinates stable", () => {
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    mesh.position.set(5000, 0, 0);
    scene.add(mesh);

    const camera = new THREE.PerspectiveCamera();
    camera.position.set(5000, 10, 64);
    const ctrl = controls(new THREE.Vector3(5000, 0, 64));
    const player = playerAt(5000, 64);
    const floatingOrigin = new FloatingOriginController(scene, {
      enabled: true,
      snapMeters: 1024,
      unboundedWorld: true,
    });

    const rebased = floatingOrigin.rebaseIfNeeded({ camera, controls: ctrl, player, frameIndex: 7 });

    expect(rebased).toBe(true);
    expect(floatingOrigin.stats().rebaseCount).toBe(1);
    expect(floatingOrigin.stats().originX).toBe(4096);
    expect(camera.position.x).toBe(904);
    expect(mesh.position.x).toBe(904);
    expect(player.position.x).toBe(904);
    expect(ctrl.target.x).toBe(904);

    const worldCamera = floatingOrigin.getWorldCamera(camera);
    expect(worldCamera.position.x).toBe(5000);
    expect(worldCamera.position.z).toBe(64);
  });

  it("does not rebase below the snap threshold", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(900, 1, 0);
    const floatingOrigin = new FloatingOriginController(scene, {
      enabled: true,
      snapMeters: 1024,
      unboundedWorld: true,
    });

    expect(floatingOrigin.rebaseIfNeeded({ camera, controls: controls(), player: playerAt(900, 0), frameIndex: 1 })).toBe(false);
    expect(floatingOrigin.stats().rebaseCount).toBe(0);
    expect(floatingOrigin.getWorldCamera(camera).position.x).toBe(900);
  });
});
