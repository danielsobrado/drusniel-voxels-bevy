import { describe, expect, it } from "vitest";
import {
  resolveLiveBubbleBuildBudget,
  resolveLiveBubbleColliderRadius,
  resolveLiveBubbleGpuChunkBudget,
  resolveLiveBubbleMaxInflightChunks,
} from "./near_field_bubble_controller.js";

describe("resolveLiveBubbleBuildBudget", () => {
  it("keeps the configured default when no override is provided", () => {
    expect(resolveLiveBubbleBuildBudget(4, new URLSearchParams())).toBe(4);
  });

  it("uses a conservative default for infinite islands", () => {
    expect(resolveLiveBubbleBuildBudget(4, new URLSearchParams("scene=infinite-islands"))).toBe(1);
  });

  it("accepts the camelCase query override", () => {
    expect(resolveLiveBubbleBuildBudget(4, new URLSearchParams("liveBubbleBudget=7"))).toBe(7);
  });

  it("accepts the snake_case query override", () => {
    expect(resolveLiveBubbleBuildBudget(4, new URLSearchParams("live_bubble_budget=3"))).toBe(3);
  });

  it("lets query override beat the infinite islands conservative default", () => {
    expect(resolveLiveBubbleBuildBudget(4, new URLSearchParams("scene=infinite-islands&liveBubbleBudget=3"))).toBe(3);
  });

  it("floors fractional values and clamps invalid budgets to one", () => {
    expect(resolveLiveBubbleBuildBudget(4, new URLSearchParams("liveBubbleBudget=2.9"))).toBe(2);
    expect(resolveLiveBubbleBuildBudget(Number.NaN, new URLSearchParams("liveBubbleBudget=0"))).toBe(1);
  });
});

describe("resolveLiveBubbleGpuChunkBudget", () => {
  it("keeps the safe default without an override", () => {
    expect(resolveLiveBubbleGpuChunkBudget(2, new URLSearchParams("scene=infinite-islands"))).toBe(2);
  });

  it("accepts camelCase and snake_case query overrides", () => {
    expect(resolveLiveBubbleGpuChunkBudget(2, new URLSearchParams("liveBubbleGpuChunkBudget=12"))).toBe(12);
    expect(resolveLiveBubbleGpuChunkBudget(2, new URLSearchParams("live_bubble_gpu_chunk_budget=16"))).toBe(16);
  });
});

describe("resolveLiveBubbleMaxInflightChunks", () => {
  it("keeps the default without an override", () => {
    expect(resolveLiveBubbleMaxInflightChunks(256, new URLSearchParams())).toBe(256);
  });

  it("accepts camelCase and snake_case query overrides", () => {
    expect(resolveLiveBubbleMaxInflightChunks(256, new URLSearchParams("liveBubbleMaxInflightChunks=128"))).toBe(128);
    expect(resolveLiveBubbleMaxInflightChunks(256, new URLSearchParams("live_bubble_max_inflight_chunks=64"))).toBe(64);
  });
});

describe("resolveLiveBubbleColliderRadius", () => {
  it("uses no radius split by default and accepts aliases", () => {
    expect(resolveLiveBubbleColliderRadius(new URLSearchParams())).toBeNull();
    expect(resolveLiveBubbleColliderRadius(new URLSearchParams("liveBubbleColliderRadius=128"))).toBe(128);
    expect(resolveLiveBubbleColliderRadius(new URLSearchParams("live_bubble_collider_radius=96"))).toBe(96);
  });
});
