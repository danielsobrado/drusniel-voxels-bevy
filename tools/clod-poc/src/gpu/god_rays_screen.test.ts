import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { projectSunToScreen } from "./god_rays_screen.js";

function frontCamera(): THREE.PerspectiveCamera {
  // Default orientation looks down -Z from the origin.
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(0, 0, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return camera;
}

describe("projectSunToScreen", () => {
  it("maps a sun straight ahead to the screen centre and reports it visible", () => {
    const camera = frontCamera();
    const info = projectSunToScreen(new THREE.Vector3(0, 0, -1), camera);
    expect(info.visible).toBe(true);
    expect(info.u).toBeCloseTo(0.5, 4);
    expect(info.v).toBeCloseTo(0.5, 4);
  });

  it("reports the sun as not visible when it is behind the camera", () => {
    const camera = frontCamera();
    const info = projectSunToScreen(new THREE.Vector3(0, 0, 1), camera);
    expect(info.visible).toBe(false);
  });

  it("places a sun to the camera's right past screen centre", () => {
    const camera = frontCamera();
    const info = projectSunToScreen(new THREE.Vector3(1, 0, -1).normalize(), camera);
    expect(info.visible).toBe(true);
    expect(info.u).toBeGreaterThan(0.5);
    expect(info.v).toBeCloseTo(0.5, 4);
  });

  it("places a sun above the horizon past vertical centre", () => {
    const camera = frontCamera();
    const info = projectSunToScreen(new THREE.Vector3(0, 1, -1).normalize(), camera);
    expect(info.visible).toBe(true);
    expect(info.v).toBeGreaterThan(0.5);
    expect(info.u).toBeCloseTo(0.5, 4);
  });

  it("honours camera yaw so a world sun moves opposite the look direction", () => {
    const camera = frontCamera();
    camera.rotateY(THREE.MathUtils.degToRad(-30)); // look slightly to the right
    camera.updateMatrixWorld(true);
    const info = projectSunToScreen(new THREE.Vector3(0, 0, -1), camera);
    // The world-forward sun is now to the left of where the camera points.
    expect(info.visible).toBe(true);
    expect(info.u).toBeLessThan(0.5);
  });
});
