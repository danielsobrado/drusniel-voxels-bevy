import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  cloneTreeSettings,
  createTreeImpostorBlendNodeMaterial,
  createTreeImpostorNodeMaterial,
  octFrames,
  TREE_IMPOSTOR_BLEND_FRAGMENT_SHADER,
  TREE_IMPOSTOR_BLEND_VERTEX_SHADER,
  TREE_IMPOSTOR_FRAGMENT_SHADER,
  TREE_IMPOSTOR_VERTEX_SHADER,
  type TreeImpostorAtlas,
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

  it("sets positionNode on WebGPU single-frame impostor materials", () => {
    const material = createTreeImpostorNodeMaterial(cloneTreeSettings(), fakeAtlas());
    expect((material as unknown as { positionNode?: unknown }).positionNode).toBeDefined();
  });

  it("sets positionNode on WebGPU four-tile blend impostor materials", () => {
    const material = createTreeImpostorBlendNodeMaterial(cloneTreeSettings(), fakeAtlas());
    expect((material as unknown as { positionNode?: unknown }).positionNode).toBeDefined();
  });

  it("uses billboard-facing normals for WebGPU node relight", () => {
    const source = readFileSync(new URL("./tree_impostor_material.ts", import.meta.url), "utf8");

    expect(source).toContain("treeImpostorNodeBillboardNormal");
    expect(source).toContain("relightTreeImpostorNode(albedo, normalSample, billboardNormal)");
    expect(source).toContain("billboardNormal, capturedNormal");
    expect(source).toContain("TREE_IMPOSTOR_NORMAL_DETAIL_WEIGHT");
  });

  it("uses unlit WebGPU node materials so the manual relight is not lit twice", () => {
    const source = readFileSync(new URL("./tree_impostor_material.ts", import.meta.url), "utf8");

    expect(source).not.toContain("MeshPhysicalNodeMaterial");
    expect(source).toContain("createTreeUnlitImpostorNodeMaterial");
    expect(source).toContain("new MeshBasicNodeMaterial()");
    expect(source).toContain("material.normalNode = normalNode");
  });

  it("coverage-normalizes straight-alpha atlas colors before relighting", () => {
    const source = readFileSync(new URL("./tree_impostor_material.ts", import.meta.url), "utf8");

    expect(source).toContain("decodeCoverageNormalizedTreeImpostorNodeAlbedo");
    expect(source).toContain("sample.xyz.div(max(sample.w, float(TREE_IMPOSTOR_MIN_COVERAGE)))");
    expect(TREE_IMPOSTOR_FRAGMENT_SHADER).toContain("color.rgb / max(color.a, 0.0001)");
    expect(TREE_IMPOSTOR_BLEND_FRAGMENT_SHADER).toContain("treeImpostorDecodeAlbedo(c0) * weightedCoverage.x");
  });
});

function fakeAtlas(): TreeImpostorAtlas {
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  return {
    species: "oak",
    texture,
    albedo: texture,
    normalDepth: texture,
    gridSize: 8,
    resolutionPx: 128,
    atlasSizePx: 1024,
    frames: octFrames(8, 128, 2),
    ready: true,
    dispose() {
      texture.dispose();
    },
  };
}
