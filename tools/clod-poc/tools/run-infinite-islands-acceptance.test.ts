import { describe, expect, it } from "vitest";

describe("normalizeAcceptanceArgs route water", () => {
  it("force-adds water for non-calibrate continent route runs", async () => {
    const { normalizeAcceptanceArgs } = await import("./run-infinite-islands-acceptance.mjs");
    const next = normalizeAcceptanceArgs(["--short-route", "--scene", "walk", "--gate", "perf", "--reuse"]);
    expect(next).toContain("--scene");
    const sceneIdx = next.lastIndexOf("--scene");
    expect(next[sceneIdx + 1]).toBe("water");
  });

  it("skips forced water during --calibrate", async () => {
    const { normalizeAcceptanceArgs } = await import("./run-infinite-islands-acceptance.mjs");
    const next = normalizeAcceptanceArgs([
      "--short-route",
      "--scene",
      "walk",
      "--gate",
      "perf",
      "--reuse",
      "--calibrate",
    ]);
    expect(next).toEqual([
      "--short-route",
      "--scene",
      "walk",
      "--gate",
      "perf",
      "--reuse",
      "--calibrate",
    ]);
  });
});
