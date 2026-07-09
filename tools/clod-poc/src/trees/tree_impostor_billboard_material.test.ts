import { describe, expect, it } from "vitest";
import {
  TREE_IMPOSTOR_BLEND_FRAGMENT_SHADER,
  TREE_IMPOSTOR_BLEND_VERTEX_SHADER,
  TREE_IMPOSTOR_FRAGMENT_SHADER,
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

  it("passes billboard-facing normals into classic relight", () => {
    expect(TREE_IMPOSTOR_VERTEX_SHADER).toContain("varying vec3 vTreeImpostorBillboardNormal");
    expect(TREE_IMPOSTOR_VERTEX_SHADER).toContain("vTreeImpostorBillboardNormal = treeImpostorBillboardNormal(origin)");
    expect(TREE_IMPOSTOR_FRAGMENT_SHADER).toContain("TREE_IMPOSTOR_NORMAL_DETAIL_WEIGHT");
    expect(TREE_IMPOSTOR_FRAGMENT_SHADER).toContain("mix(normalize(billboardNormal), capturedNormal");
    expect(TREE_IMPOSTOR_FRAGMENT_SHADER).toContain("treeImpostorRelight(albedo, normalDepth.rgb, vTreeImpostorBillboardNormal)");
  });

  it("passes billboard-facing normals into four-tile blend relight", () => {
    expect(TREE_IMPOSTOR_BLEND_VERTEX_SHADER).toContain("varying vec3 vTreeImpostorBillboardNormal");
    expect(TREE_IMPOSTOR_BLEND_VERTEX_SHADER).toContain("vTreeImpostorBillboardNormal = treeImpostorBillboardNormal(origin)");
    expect(TREE_IMPOSTOR_BLEND_FRAGMENT_SHADER).toContain("TREE_IMPOSTOR_NORMAL_DETAIL_WEIGHT");
    expect(TREE_IMPOSTOR_BLEND_FRAGMENT_SHADER).toContain("mix(normalize(billboardNormal), capturedNormal");
    expect(TREE_IMPOSTOR_BLEND_FRAGMENT_SHADER).toContain("treeImpostorRelight(albedo, normal, vTreeImpostorBillboardNormal)");
  });
});
