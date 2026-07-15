import { describe, expect, it } from "vitest";
import source from "./tree_crown_proxy_node_material.ts?raw";
import { cloneTreeSettings, createTreeCrownProxyNodeMaterialHandle } from "./index.js";
import { StorageInstancedBufferAttribute } from "three/webgpu";

describe("tree crown proxy node material", () => {
  it("creates disposable regular and debug materials", () => {
    const buffers = { cell: new StorageInstancedBufferAttribute(4, 4), capacity: 4 };
    const handle = createTreeCrownProxyNodeMaterialHandle(cloneTreeSettings(), buffers, "oak", "far");

    expect(handle.regularMaterial).toBeDefined();
    expect(handle.debugMaterials.far).toBeDefined();
    expect(handle.debugMaterials.impostor).toBeDefined();
    expect(() => handle.setFadeCenter?.(10, 20)).not.toThrow();
    expect(() => handle.updateSettings?.(cloneTreeSettings())).not.toThrow();
    expect(() => handle.dispose()).not.toThrow();
  });

  it("keeps the proxy placement and mask contract in source", () => {
    expect(source).toContain("treeMorphologyRecordNodes(buffers)");
    expect(source).toContain("positionGeometry");
    expect(source).toContain("uRadius.x.mul(crownWidth)");
    expect(source).toContain("uRadius.y.mul(crownFlattening).mul(ageHeightScale)");
    expect(source).toContain("treeCrownProxyDimensions(settings, species)");
    expect(source).toContain("smoothstep(float(0.70), float(1.0), radial)");
    expect(source).toContain("treeMorphologyHash01Node(");
    expect(source).toContain("floatBitsToUint(record.identityBits.zw)");
    expect(source).not.toContain("screenCoordinate");
    expect(source).toContain("proxyFade(distanceM, uFarDistance, uImpostorDistance, uBandDistance, uLodIndex)");
    expect(source).toContain("material.colorWrite = false");
  });
});
