import { describe, expect, it } from "vitest";
import { riverCobbleGpuEnabled } from "./river_cobble_runtime.js";

describe("river cobble runtime flag", () => {
  it("is disabled by default", () => {
    expect(riverCobbleGpuEnabled("")).toBe(false);
  });

  it("accepts primary and alias enable flags", () => {
    expect(riverCobbleGpuEnabled("?riverCobbles=1")).toBe(true);
    expect(riverCobbleGpuEnabled("?underwaterCobbles=true")).toBe(true);
    expect(riverCobbleGpuEnabled("?stoneRiverCobbles")).toBe(true);
  });

  it("honors explicit disable values", () => {
    expect(riverCobbleGpuEnabled("?riverCobbles=0")).toBe(false);
    expect(riverCobbleGpuEnabled("?riverCobbles=off")).toBe(false);
  });
});
