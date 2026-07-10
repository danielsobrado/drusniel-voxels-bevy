import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { createBrushPreviewController } from "./brush_preview_controller.js";

const HIT_POINT = new THREE.Vector3(12, 34, 56);

function baseOptions() {
  const orbitRay = new THREE.Ray(new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, -1, 0));
  return {
    digEnabled: true,
    interactionMode: "orbit" as const,
    terraformEditActive: true,
    brushShape: "sphere" as const,
    brushOp: "remove" as const,
    digRadius: 4,
    brushHeight: 6,
    raycastEditableTerrain: vi.fn(() => ({ point: HIT_POINT.clone(), distance: 10, pageId: "L0:0,0" })),
    getPlayingAimRay: vi.fn(() => orbitRay),
    getOrbitHoverRay: vi.fn(() => orbitRay),
  };
}

describe("brush preview controller", () => {
  it("shows the selected raise shape at the orbit hover hit", () => {
    const controller = createBrushPreviewController(new THREE.Scene());
    const options = { ...baseOptions(), brushShape: "cube" as const, brushOp: "add" as const };

    controller.update(options);

    expect(controller.mesh.visible).toBe(true);
    expect(controller.mesh.position.toArray()).toEqual(HIT_POINT.toArray());
    expect(controller.mesh.scale.toArray()).toEqual([4, 6, 4]);
    expect(controller.mesh.geometry.type).toBe("BoxGeometry");
    expect((controller.mesh.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0x55dd66);
    expect(options.raycastEditableTerrain).toHaveBeenCalledOnce();
  });

  it("does not raycast or show the ghost when edit mode is disabled", () => {
    const controller = createBrushPreviewController(new THREE.Scene());
    const options = { ...baseOptions(), terraformEditActive: false };

    controller.update(options);

    expect(controller.mesh.visible).toBe(false);
    expect(options.raycastEditableTerrain).not.toHaveBeenCalled();
  });

  it("uses the playing aim ray in player mode", () => {
    const controller = createBrushPreviewController(new THREE.Scene());
    const options = { ...baseOptions(), interactionMode: "playing" as const };

    controller.update(options);

    expect(options.getPlayingAimRay).toHaveBeenCalledOnce();
    expect(options.getOrbitHoverRay).not.toHaveBeenCalled();
    expect(controller.mesh.visible).toBe(true);
  });
});
