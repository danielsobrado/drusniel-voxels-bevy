import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  godRaysScreenFalloffReference,
  godRaysScreenUvCoverageReference,
  interleavedGradientNoiseReference,
  projectSunToScreen,
  sunScreenFade,
  type SunScreenInfo,
} from "./god_rays_screen.js";
import { godRaysHalfResSamples } from "../environment/postprocess_settings.js";

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

  it("uses the camera world position when the camera is parented", () => {
    const parent = new THREE.Group();
    parent.position.set(10_000_000, 2_000_000, -3_000_000);
    const camera = frontCamera();
    parent.add(camera);
    parent.updateMatrixWorld(true);

    const info = projectSunToScreen(new THREE.Vector3(0, 0, -1), camera);
    expect(info.visible).toBe(true);
    expect(info.u).toBeCloseTo(0.5, 4);
    expect(info.v).toBeCloseTo(0.5, 4);
  });

  it("reports the forward cosine so callers can fade near the camera plane", () => {
    const camera = frontCamera();
    expect(projectSunToScreen(new THREE.Vector3(0, 0, -1), camera).forward).toBeCloseTo(1, 5);
    expect(projectSunToScreen(new THREE.Vector3(1, 0, 0), camera).forward).toBeCloseTo(0, 5);
    expect(projectSunToScreen(new THREE.Vector3(0, 0, 1), camera).forward).toBeCloseTo(-1, 5);
  });
});

describe("interleavedGradientNoiseReference", () => {
  it("stays in [0, 1) and is deterministic", () => {
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const value = interleavedGradientNoiseReference(x, y);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
        expect(interleavedGradientNoiseReference(x, y)).toBe(value);
      }
    }
  });

  it("decorrelates neighbouring pixels (no two adjacent values collide)", () => {
    const center = interleavedGradientNoiseReference(10, 10);
    expect(Math.abs(interleavedGradientNoiseReference(11, 10) - center)).toBeGreaterThan(0.05);
    expect(Math.abs(interleavedGradientNoiseReference(10, 11) - center)).toBeGreaterThan(0.05);
  });
});

describe("godRaysScreenUvCoverageReference", () => {
  it("keeps samples on the viewport including exact edges", () => {
    expect(godRaysScreenUvCoverageReference(0, 0)).toBe(1);
    expect(godRaysScreenUvCoverageReference(0.5, 0.5)).toBe(1);
    expect(godRaysScreenUvCoverageReference(1, 1)).toBe(1);
  });

  it("rejects samples beyond any viewport edge", () => {
    expect(godRaysScreenUvCoverageReference(-0.001, 0.5)).toBe(0);
    expect(godRaysScreenUvCoverageReference(1.001, 0.5)).toBe(0);
    expect(godRaysScreenUvCoverageReference(0.5, -0.001)).toBe(0);
    expect(godRaysScreenUvCoverageReference(0.5, 1.001)).toBe(0);
  });
});

describe("godRaysScreenFalloffReference", () => {
  it("fades monotonically from the sun to zero", () => {
    const center = godRaysScreenFalloffReference(0);
    const near = godRaysScreenFalloffReference(0.35);
    const mid = godRaysScreenFalloffReference(0.7);
    const edge = godRaysScreenFalloffReference(1.4);
    const outside = godRaysScreenFalloffReference(2);

    expect(center).toBe(1);
    expect(center).toBeGreaterThan(near);
    expect(near).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(edge);
    expect(edge).toBe(0);
    expect(outside).toBe(0);
  });
});

describe("sunScreenFade", () => {
  const onScreen = (u: number, v: number, forward = 1): SunScreenInfo => ({
    u,
    v,
    visible: forward > 0,
    forward,
  });

  it("is full strength while the sun is comfortably on screen", () => {
    expect(sunScreenFade(onScreen(0.5, 0.5))).toBeCloseTo(1, 5);
    expect(sunScreenFade(onScreen(0.05, 0.9))).toBeCloseTo(1, 5);
  });

  it("is zero when the sun is behind the camera", () => {
    expect(sunScreenFade(onScreen(0.5, 0.5, -0.4))).toBe(0);
    expect(sunScreenFade(onScreen(0.5, 0.5, 0))).toBe(0);
  });

  it("fades smoothly to zero as the sun leaves the frame", () => {
    const nearEdge = sunScreenFade(onScreen(1.05, 0.5));
    const farther = sunScreenFade(onScreen(1.2, 0.5));
    const gone = sunScreenFade(onScreen(1.5, 0.5));
    expect(nearEdge).toBeGreaterThan(farther);
    expect(farther).toBeGreaterThan(0);
    expect(gone).toBe(0);
  });

  it("fades in as the sun crosses the camera plane instead of popping", () => {
    const grazing = sunScreenFade(onScreen(0.5, 0.5, 0.03));
    expect(grazing).toBeGreaterThan(0);
    expect(grazing).toBeLessThan(1);
  });
});

describe("godRaysHalfResSamples", () => {
  it("maps modes to the half-res tap budget", () => {
    expect(godRaysHalfResSamples("off")).toBe(0);
    expect(godRaysHalfResSamples("cheap")).toBe(16);
    expect(godRaysHalfResSamples("heavy")).toBe(28);
    expect(godRaysHalfResSamples("volumetric")).toBe(28);
  });
});
