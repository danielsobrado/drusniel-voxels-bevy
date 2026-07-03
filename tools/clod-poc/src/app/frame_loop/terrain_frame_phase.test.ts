import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { vegetationRingCenter } from "./terrain_frame_phase.js";

describe("vegetationRingCenter", () => {
  it("keeps legacy vegetation inside finite world bounds", () => {
    const center = vegetationRingCenter(new THREE.Vector3(1600, 3, -300), 1024, false);

    expect(center.x).toBe(1022);
    expect(center.y).toBe(3);
    expect(center.z).toBe(2);
  });

  it("lets infinite islands vegetation follow the moving player", () => {
    const center = vegetationRingCenter(new THREE.Vector3(1600, 3, -300), 1024, true);

    expect(center.x).toBe(1600);
    expect(center.y).toBe(3);
    expect(center.z).toBe(-300);
  });
});
