import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { computeErrorPx, computeNodeDistanceToCamera, computeNodeErrorPx } from "../runtime/clodError.js";
import type { ClodPageNodeRuntime } from "../runtime/clodRuntimeTypes.js";

function makeNode(center: [number, number, number], radius: number, errorWorld: number): ClodPageNodeRuntime {
  return {
    id: "test",
    level: 0,
    parentId: null,
    childIds: [],
    footprint: { minX: center[0] - radius, minZ: center[2] - radius, maxX: center[0] + radius, maxZ: center[2] + radius },
    boundingSphere: { center, radius },
    errorWorld,
    minY: center[1] - radius,
    maxY: center[1] + radius,
    lowBenefit: false,
    ready: true,
  };
}

function makeCamera(position: THREE.Vector3, fov = 55): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(fov, 16 / 9, 0.1, 1000);
  cam.position.copy(position);
  cam.lookAt(0, 0, 0);
  return cam;
}

describe("clodError", () => {
  it("error decreases with distance", () => {
    const errorWorld = 10;
    const viewportH = 720;
    const fovY = Math.PI / 3;

    const close = computeErrorPx({ errorWorld, distanceToCamera: 10, viewportHeightPx: viewportH, fovYRadians: fovY });
    const far = computeErrorPx({ errorWorld, distanceToCamera: 100, viewportHeightPx: viewportH, fovYRadians: fovY });

    expect(far).toBeLessThan(close);
  });

  it("error increases with world error", () => {
    const viewportH = 720;
    const fovY = Math.PI / 3;
    const dist = 50;

    const low = computeErrorPx({ errorWorld: 1, distanceToCamera: dist, viewportHeightPx: viewportH, fovYRadians: fovY });
    const high = computeErrorPx({ errorWorld: 10, distanceToCamera: dist, viewportHeightPx: viewportH, fovYRadians: fovY });

    expect(high).toBeGreaterThan(low);
  });

  it("error increases with viewport height", () => {
    const errorWorld = 5;
    const fovY = Math.PI / 3;
    const dist = 50;

    const small = computeErrorPx({ errorWorld, distanceToCamera: dist, viewportHeightPx: 480, fovYRadians: fovY });
    const large = computeErrorPx({ errorWorld, distanceToCamera: dist, viewportHeightPx: 1080, fovYRadians: fovY });

    expect(large).toBeGreaterThan(small);
  });

  it("handles near-zero distance safely", () => {
    const result = computeErrorPx({ errorWorld: 1, distanceToCamera: 0.001, viewportHeightPx: 720, fovYRadians: Math.PI / 3 });
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBeGreaterThan(0);
    expect(Number.isNaN(result)).toBe(false);
    expect(result !== Infinity).toBe(true);
  });

  it("computeNodeDistanceToCamera returns finite value", () => {
    const node = makeNode([0, 0, 0], 5, 1);
    const camera = makeCamera(new THREE.Vector3(10, 10, 10));
    const dist = computeNodeDistanceToCamera(node, camera);
    expect(dist).toBeGreaterThan(0);
    expect(Number.isFinite(dist)).toBe(true);
  });

  it("computeNodeErrorPx integrates all parameters", () => {
    const node = makeNode([0, 0, 0], 5, 2);
    const camera = makeCamera(new THREE.Vector3(20, 5, 20));
    const viewportH = 720;
    const fovY = THREE.MathUtils.degToRad(camera.fov);

    const result = computeNodeErrorPx(node, camera, viewportH, fovY);
    expect(result).toBeGreaterThan(0);
    expect(Number.isFinite(result)).toBe(true);
  });
});
