import * as THREE from "three";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildAllLodsExportScene, disposeAllLodsExportScene, exportAllLodsToGlb } from "./gltf_export.js";
import type { ClodPageNode, PageMesh } from "../types.js";

const mesh: PageMesh = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
  normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
  paintSlots: new Float32Array([1, 2, 0]),
  materialWeights: new Float32Array(12),
  materialWeightStride: 4,
  indices: new Uint32Array([0, 1, 2]),
};

function node(level: number, id: string): ClodPageNode {
  return {
    id,
    level,
    children: [],
    mesh,
    footprint: { minX: 0, minZ: 0, maxX: 16 << level, maxZ: 16 << level },
    bounds: { center: [0.5, 0, 0.5], radius: 1, minY: 0, maxY: 0 },
    errorWorld: level * 0.5,
    lowBenefit: false,
  };
}

class TestFileReader {
  result: string | ArrayBuffer | null = null;
  onloadend: ((event: ProgressEvent<FileReader>) => void) | null = null;

  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((result) => {
      this.result = result;
      this.onloadend?.({ target: this } as unknown as ProgressEvent<FileReader>);
    });
  }
}

const originalFileReader = globalThis.FileReader;

beforeAll(() => {
  globalThis.FileReader = TestFileReader as unknown as typeof FileReader;
});

afterAll(() => {
  globalThis.FileReader = originalFileReader;
});

describe("all-LOD GLB export", () => {
  it("builds named overlapping LOD groups with page metadata and paint weights", () => {
    const scene = buildAllLodsExportScene(new Map([[0, [node(0, "L0:0,0")]], [1, [node(1, "L1:0,0")]]]));
    expect(scene.children.map((child) => child.name)).toEqual(["LOD0", "LOD1"]);
    const exportedMesh = scene.getObjectByName("L1:0,0") as THREE.Mesh;
    expect(exportedMesh.userData).toMatchObject({ pageId: "L1:0,0", lodLevel: 1, errorWorld: 0.5 });
    expect((exportedMesh.geometry as THREE.BufferGeometry).getAttribute("paintSlot").itemSize).toBe(1);
    disposeAllLodsExportScene(scene);
  });

  it("writes the custom paint attribute as _PAINTSLOT in binary glTF", async () => {
    const glb = await exportAllLodsToGlb(new Map([[0, [node(0, "L0:0,0")]]]));
    const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
    const jsonLength = view.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength)).trim()) as {
      meshes: { primitives: { attributes: Record<string, number> }[] }[];
      nodes: { name?: string; extras?: Record<string, unknown> }[];
    };
    expect(json.meshes[0].primitives[0].attributes).toHaveProperty("_PAINTSLOT");
    expect(json.nodes.find((entry) => entry.name === "L0:0,0")?.extras).toMatchObject({ pageId: "L0:0,0" });
  });
});
