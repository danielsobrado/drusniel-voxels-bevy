import { describe, expect, it } from "vitest";
import {
  TREE_IMPOSTOR_BLEND_VERTEX_SHADER,
  TREE_IMPOSTOR_VERTEX_SHADER,
} from "./index.js";

describe("tree impostor billboard materials", () => {
  it("makes classic impostor cards face the camera in world space", () => {
    expect(TREE_IMPOSTOR_VERTEX_SHADER).toContain("treeImpostorBillboardWorldPosition");
    expect(TREE_IMPOSTOR_VERTEX_SHADER).toContain("cameraPosition - origin");
    expect(TREE_IMPOSTOR_VERTEX_SHADER).toContain("projectionMatrix * viewMatrix");
    expect(TREE_IMPOSTOR_VERTEX_SHADER).not.toContain("instanceMatrix * transformed");
  });

  it("keeps four-tile blend impostors on the same billboard path", () => {
    expect(TREE_IMPOSTOR_BLEND_VERTEX_SHADER).toContain("treeImpostorBillboardWorldPosition");
    expect(TREE_IMPOSTOR_BLEND_VERTEX_SHADER).toContain("cameraPosition - origin");
    expect(TREE_IMPOSTOR_BLEND_VERTEX_SHADER).toContain("projectionMatrix * viewMatrix");
    expect(TREE_IMPOSTOR_BLEND_VERTEX_SHADER).not.toContain("instanceMatrix * transformed");
  });
});
