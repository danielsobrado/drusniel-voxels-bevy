import { describe, expect, it } from "vitest";
import treeCullShader from "../gpu/shaders/tree_cull.compute.wgsl?raw";
import { DEFAULT_TREE_SETTINGS } from "./tree_config.js";
import {
  classifyTreeCandidateCpu,
  makeTreeGpuCullParams,
  packTreeGpuCullParams,
  packTreeGpuCandidates,
  TREE_GPU_CANDIDATE_FLOATS,
  TREE_GPU_CULL_PARAM_BYTES,
  TREE_GPU_VISIBLE_U32S,
  treeGpuSpeciesId,
  unpackTreeGpuCandidate,
  unpackTreeGpuVisibleRecords,
} from "./tree_gpu_types.js";
import { treeInstancesToGpuCandidates } from "./tree_gpu_scatter.js";
import type { TreeInstance } from "./tree_instances.js";

describe("tree GPU candidate packing", () => {
  it("packs tree instances into stable 32-byte candidate records", () => {
    const instances: TreeInstance[] = [
      { position: [1, 2, 3], species: "pine", scale: 1.25, rotationY: 0.5, normalY: 1 },
      { position: [4, 5, 6], species: "dead", scale: 0.75, rotationY: 1.5, normalY: 0.9 },
    ];

    const packed = treeInstancesToGpuCandidates(instances);
    expect(packed.length).toBe(instances.length * TREE_GPU_CANDIDATE_FLOATS);
    expect(unpackTreeGpuCandidate(packed, 0)).toMatchObject({
      worldX: 1,
      worldY: 2,
      worldZ: 3,
      scale: 1.25,
      rotationY: 0.5,
      species: treeGpuSpeciesId("pine"),
    });
    expect(unpackTreeGpuCandidate(packed, 1).species).toBe(treeGpuSpeciesId("dead"));
  });

  it("returns an empty candidate buffer for zero instances", () => {
    expect(treeInstancesToGpuCandidates([])).toHaveLength(0);
    expect(packTreeGpuCandidates([])).toHaveLength(0);
  });

  it("unpacks visible records from GPU u32 layout", () => {
    const packed = new Uint32Array([
      7, 2, treeGpuSpeciesId("oak"), 0,
      8, 3, treeGpuSpeciesId("pine"), 1,
    ]);

    expect(unpackTreeGpuVisibleRecords(packed)).toEqual([
      { candidateIndex: 7, lod: 2, species: treeGpuSpeciesId("oak"), reserved: 0 },
      { candidateIndex: 8, lod: 3, species: treeGpuSpeciesId("pine"), reserved: 1 },
    ]);
    expect(TREE_GPU_VISIBLE_U32S).toBe(4);
  });
});

describe("tree GPU CPU reference culling", () => {
  const settings = {
    ...DEFAULT_TREE_SETTINGS,
    distanceM: 100,
    lod: {
      ...DEFAULT_TREE_SETTINGS.lod,
      nearFraction: 0.25,
      midFraction: 0.5,
      farFraction: 0.75,
      impostorFraction: 1,
    },
  };
  const params = makeTreeGpuCullParams(settings, {
    centerX: 0,
    centerZ: 0,
    cameraX: 0,
    cameraZ: 0,
    candidateCount: 4,
    maxVisible: 100,
  });

  it("classifies near, mid, far, and impostor boundaries deterministically", () => {
    expect(classifyTreeCandidateCpu({ worldX: 25, worldZ: 0, species: 0 }, params)?.lod).toBe(0);
    expect(classifyTreeCandidateCpu({ worldX: 50, worldZ: 0, species: 0 }, params)?.lod).toBe(1);
    expect(classifyTreeCandidateCpu({ worldX: 75, worldZ: 0, species: 0 }, params)?.lod).toBe(2);
    expect(classifyTreeCandidateCpu({ worldX: 100, worldZ: 0, species: 0 }, params)?.lod).toBe(3);
  });

  it("rejects candidates beyond impostor distance plus padding", () => {
    expect(classifyTreeCandidateCpu({ worldX: 109, worldZ: 0, species: 0 }, params)).toBeNull();
  });

  it("packs params in the same word layout used by WGSL", () => {
    const packed = packTreeGpuCullParams(params);
    const f32 = new Float32Array(packed);
    const u32 = new Uint32Array(packed);
    expect(packed.byteLength).toBe(TREE_GPU_CULL_PARAM_BYTES);
    expect(f32[0]).toBe(0);
    expect(f32[2]).toBe(25);
    expect(f32[5]).toBe(100);
    expect(u32[8]).toBe(4);
    expect(u32[9]).toBe(100);
  });
});

describe("tree GPU cull shader source", () => {
  it("contains the expected bindings and culling logic", () => {
    expect(treeCullShader).toContain("@binding(0) var<storage, read> candidates");
    expect(treeCullShader).toContain("@binding(1) var<storage, read_write> visibleRecords");
    expect(treeCullShader).toContain("atomicAdd");
    expect(treeCullShader).toContain("outputIndex >= params.maxVisible");
    expect(treeCullShader).toContain("tree_lod_for_distance");
  });
});
