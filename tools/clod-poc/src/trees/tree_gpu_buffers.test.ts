import { describe, expect, it } from "vitest";
import { DEFAULT_TREE_SETTINGS } from "./tree_config.js";
import { treeGpuBufferSizes } from "./tree_gpu_buffers.js";
import {
  TREE_GPU_CANDIDATE_BYTES,
  TREE_GPU_VISIBLE_BYTES,
} from "./tree_gpu_types.js";

describe("tree GPU buffer sizing", () => {
  it("allocates at least one record worth of bytes for zero capacities", () => {
    const sizes = treeGpuBufferSizes(DEFAULT_TREE_SETTINGS, 0, 0);
    expect(sizes.candidateCapacity).toBe(0);
    expect(sizes.visibleCapacity).toBe(0);
    expect(sizes.candidateBytes).toBe(TREE_GPU_CANDIDATE_BYTES);
    expect(sizes.visibleBytes).toBe(TREE_GPU_VISIBLE_BYTES);
  });

  it("clamps capacities to GPU tree settings", () => {
    const sizes = treeGpuBufferSizes({
      ...DEFAULT_TREE_SETTINGS,
      gpu: {
        ...DEFAULT_TREE_SETTINGS.gpu,
        maxCandidates: 10,
        maxVisible: 5,
      },
    }, 100, 100);

    expect(sizes.candidateCapacity).toBe(10);
    expect(sizes.visibleCapacity).toBe(5);
    expect(sizes.candidateBytes).toBe(10 * TREE_GPU_CANDIDATE_BYTES);
    expect(sizes.visibleBytes).toBe(5 * TREE_GPU_VISIBLE_BYTES);
  });
});
