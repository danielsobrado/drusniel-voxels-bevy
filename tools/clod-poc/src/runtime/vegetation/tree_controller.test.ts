import { describe, expect, it } from "vitest";
import { createFallingTreeInstancedMesh } from "./tree_controller.js";

describe("falling-tree draw", () => {
  it("starts empty so unused capacity is never submitted", () => {
    const mesh = createFallingTreeInstancedMesh();

    expect(mesh.name).toBe("falling-tree-instances");
    expect(mesh.count).toBe(0);
    expect(mesh.visible).toBe(false);

    mesh.geometry.dispose();
    if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose());
    else mesh.material.dispose();
    mesh.dispose();
  });
});
