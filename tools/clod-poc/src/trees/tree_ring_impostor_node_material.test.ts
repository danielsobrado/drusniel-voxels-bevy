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
  it("creates a material handle with regular and debug materials", () => {
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

  it("samples a deterministic variant row for GPU ring impostors", () => {
    const source = readFileSync(new URL("./tree_ring_impostor_node_material.ts", import.meta.url), "utf8");

    expect(source).toContain("treeRingImpostorVariant(worldCell, uSeed, atlas)");
    expect(source).toContain("TREE_RING_VARIANT_SALT");
    expect(source).toContain("atlas.atlasHeightPx");
    expect(source).toContain("safeVariant.mul(pageSize)");
  });

  it("blends captured normals with the cylindrical billboard facing normal", () => {
    const source = readFileSync(new URL("./tree_ring_impostor_node_material.ts", import.meta.url), "utf8");

    expect(source).toContain("treeRingCylindricalBillboardNormal");
    expect(source).toContain("billboardNormal");
    expect(source).toContain("TREE_RING_IMPOSTOR_NORMAL_DETAIL_WEIGHT");
    expect(source).toContain("treeRingImpostorSurfaceNormal");
    expect(source).toContain("relightTreeRingImpostor(albedo, impostor.normal, billboardNormal");
  });

  it("uses physical WebGPU node materials with impostor normal nodes", () => {
    const source = readFileSync(new URL("./tree_ring_impostor_node_material.ts", import.meta.url), "utf8");

    expect(source).toContain("MeshPhysicalNodeMaterial");
    expect(source).toContain("createTreeRingPhysicalNodeMaterial");
    expect(source).toContain("material.normalNode = normalNode");
    expect(source).toContain("TREE_RING_IMPOSTOR_PHYSICAL_ROUGHNESS");
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
    atlasHeightPx: 2048,
    variantCount: 2,
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
