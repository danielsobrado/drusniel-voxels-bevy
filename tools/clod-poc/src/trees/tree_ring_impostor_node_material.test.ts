import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { StorageInstancedBufferAttribute } from "three/webgpu";
import {
  cloneTreeSettings,
  createTreeRingImpostorNodeMaterialHandle,
  octFrames,
  TREE_LODS,
  type TreeImpostorAtlas,
  type TreeRingInstanceBuffers,
} from "./index.js";

describe("GPU ring baked impostor node material", () => {
  it("creates a material handle with regular, debug, and prepass materials", () => {
    const handle = createTreeRingImpostorNodeMaterialHandle(
      cloneTreeSettings(),
      buffers(),
      atlas(),
    );

    expect(handle.regularMaterial.name).toBe("");
    for (const lod of TREE_LODS) expect(handle.debugMaterials[lod]).toBeDefined();
    expect(handle.setFadeCenter).toBeDefined();
    expect(handle.updateLighting).toBeDefined();
    expect(handle.updateForestLighting).toBeDefined();
    expect(handle.prepassNodesFor?.("impostor")).toBeDefined();
  });

  it("keeps render flags stable after settings updates", () => {
    const settings = cloneTreeSettings();
    const handle = createTreeRingImpostorNodeMaterialHandle(settings, buffers(), atlas());
    const material = handle.regularMaterial;
    const version = material.version;

    settings.lod.crossfadeEnabled = true;
    settings.lod.crossfadeBandM = 16;
    handle.updateSettings(settings);

    expect(material.alphaTest).toBe(0);
    expect(material.side).toBe(THREE.DoubleSide);
    expect(material.transparent).toBe(false);
    expect(material.depthWrite).toBe(true);
    expect(material.version).toBeGreaterThan(version);
  });

  it("updates fade center and lighting without replacing materials", () => {
    const handle = createTreeRingImpostorNodeMaterialHandle(cloneTreeSettings(), buffers(), atlas());
    const material = handle.regularMaterial;

    handle.setFadeCenter?.(10, 20);
    handle.updateLighting?.({
      sunDirection: new THREE.Vector3(1, 1, 0).normalize(),
      sunColor: new THREE.Color(1, 0.9, 0.8),
      skyLight: new THREE.Color(0.4, 0.5, 0.6),
      groundLight: new THREE.Color(0.2, 0.18, 0.16),
      ambientFloor: 0.02,
    });

    expect(handle.regularMaterial).toBe(material);
  });

  it("keeps the per-instance four-frame atlas blend contract", () => {
    const source = readFileSync(new URL("./tree_ring_impostor_node_material.ts", import.meta.url), "utf8");

    expect(source).toContain("treeRingImpostorFourFrameSample");
    expect(source).toContain("treeRingOctEncode(viewDirection)");
    expect(source).toContain("treeRingImpostorAtlasSample(atlas, baseUv, x0, y0, variantIndex)");
    expect(source).toContain("treeRingImpostorAtlasSample(atlas, baseUv, x1, y0, variantIndex)");
    expect(source).toContain("treeRingImpostorAtlasSample(atlas, baseUv, x0, y1, variantIndex)");
    expect(source).toContain("treeRingImpostorAtlasSample(atlas, baseUv, x1, y1, variantIndex)");
    expect(source).toContain("cameraPosition.x.sub(aWorldXZ.x)");
    expect(source).toContain("decodeTreeRingImpostorPackedNormal");
    expect(source).toContain("localNormal.x.mul(yawCos)");
  });

  it("samples the shared deterministic structural variant page", () => {
    const source = readFileSync(new URL("./tree_ring_impostor_node_material.ts", import.meta.url), "utf8");

    expect(source).toContain("record.rotationNormalY.z");
    expect(source).toContain("treeMorphologyRecordNodes(buffers)");
    expect(source).toContain("atlas.atlasHeightPx");
    expect(source).toContain("safePage.mul(pageSize)");
    expect(source).toContain("treeRingImpostorAgeSample");
    expect(source).toContain("variantIndex.mul(3)");
  });

  it("blends captured normals with the cylindrical billboard facing normal", () => {
    const source = readFileSync(new URL("./tree_ring_impostor_node_material.ts", import.meta.url), "utf8");

    expect(source).toContain("treeRingCylindricalBillboardNormal");
    expect(source).toContain("billboardNormal");
    expect(source).toContain("TREE_RING_IMPOSTOR_NORMAL_DETAIL_WEIGHT");
    expect(source).toContain("treeRingImpostorSurfaceNormal");
    expect(source).toContain("relightTreeRingImpostor(");
  });

  it("uses the shared ambient floor and preserves HDR highlights", () => {
    const source = readFileSync(new URL("./tree_ring_impostor_node_material.ts", import.meta.url), "utf8");

    expect(source).toContain("uAmbientFloor");
    expect(source).toContain("TREE_RING_IMPOSTOR_HDR_MAX");
    expect(source).toContain("hemi.add(direct).add(uAmbientFloor)");
    expect(source).not.toContain("albedo.mul(0.25)");
    expect(source).not.toContain("clamp(lit, 0.0, 1.0)");
  });

  it("applies the same forest lighting channels as mesh trees", () => {
    const source = readFileSync(new URL("./tree_ring_impostor_node_material.ts", import.meta.url), "utf8");

    expect(source).toContain("forestPacked.x.mul(uForestAoStrength)");
    expect(source).toContain("forestPacked.y.mul(uForestShadowStrength)");
    expect(source).toContain("forestPacked.z.mul(uForestFogStrength)");
    expect(source).toContain("forestPacked.w.mul(TREE_RING_IMPOSTOR_SHAFT_HINT)");
    expect(source).toContain("state.textureHandle.texture");
  });

  it("uses unlit WebGPU node materials so the manual relight is not lit twice", () => {
    const source = readFileSync(new URL("./tree_ring_impostor_node_material.ts", import.meta.url), "utf8");

    expect(source).not.toContain("MeshPhysicalNodeMaterial");
    expect(source).toContain("createTreeRingUnlitImpostorNodeMaterial");
    expect(source).toContain("new MeshBasicNodeMaterial()");
    expect(source).toContain("material.normalNode = normalNode");
  });

  it("coverage-normalizes albedo and four-frame normal blends", () => {
    const source = readFileSync(new URL("./tree_ring_impostor_node_material.ts", import.meta.url), "utf8");

    expect(source).toContain("TREE_RING_IMPOSTOR_MIN_COVERAGE");
    expect(source).toContain("sample.xyz.div(max(sample.w, float(TREE_RING_IMPOSTOR_MIN_COVERAGE)))");
    expect(source).toContain("s00.albedo.mul(s00.coverage).mul(w00)");
    expect(source).toContain("decodeTreeRingImpostorPackedNormal(s00.normal).mul(s00.coverage).mul(w00)");
  });

  it("disposes every owned material", () => {
    const handle = createTreeRingImpostorNodeMaterialHandle(cloneTreeSettings(), buffers(), atlas());
    const materials = [handle.regularMaterial, ...Object.values(handle.debugMaterials)];
    const spies = materials.map((material) => vi.spyOn(material, "dispose"));

    handle.dispose();

    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });
});

function buffers(): TreeRingInstanceBuffers {
  return {
    cell: new StorageInstancedBufferAttribute(4, 4),
    capacity: 4,
  };
}

function atlas(): TreeImpostorAtlas {
  const albedo = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const normalDepth = new THREE.DataTexture(new Uint8Array([128, 255, 128, 255]), 1, 1);
  return {
    species: "oak",
    texture: albedo,
    albedo,
    normalDepth,
    gridSize: 8,
    resolutionPx: 128,
    atlasSizePx: 1024,
    atlasWidthPx: 1024,
    atlasHeightPx: 12288,
    variantCount: 4,
    layerCount: 12,
    ageBuckets: [0.20, 0.60, 0.92],
    frames: octFrames(8, 128, 2),
    radius: 1,
    centerY: 0,
    ready: true,
    dispose() {
      albedo.dispose();
      normalDepth.dispose();
    },
  };
}
