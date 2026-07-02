import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { toSunBin } from "../sun_bins.js";

const options = { azimuthDegrees: 5, elevationDegrees: 5, minElevationDegrees: 2 };

describe("sun direction bins", () => {
  it("keeps tiny movement in one bin", () => {
    const a = toSunBin(new THREE.Vector3(1, 1, 0).normalize(), options);
    const b = toSunBin(new THREE.Vector3(1, 1, 0.01).normalize(), options);
    expect(a).toEqual(b);
  });

  it("changes when crossing azimuth step", () => {
    const a = toSunBin(new THREE.Vector3(1, 1, 0).normalize(), options);
    const b = toSunBin(new THREE.Vector3(0.9, 1, 0.2).normalize(), options);
    expect(a.azimuthIndex).not.toBe(b.azimuthIndex);
  });

  it("clamps low elevation", () => {
    const bin = toSunBin(new THREE.Vector3(1, -1, 0).normalize(), options);
    expect(bin.elevationIndex).toBe(0);
  });
});
