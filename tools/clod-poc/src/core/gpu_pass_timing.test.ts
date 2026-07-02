import { describe, expect, it } from "vitest";
import { GpuPassTiming } from "./gpu_pass_timing.js";

describe("GpuPassTiming", () => {
  it("drains timestamp queries even when pass collection is disabled", () => {
    const resolved: unknown[] = [];
    const renderer = {
      resolveTimestampsAsync: (query: unknown) => {
        resolved.push(query);
        return Promise.resolve();
      },
    };

    const timing = new GpuPassTiming(renderer as never, true, false);

    expect(timing.enabled).toBe(false);
    timing.update();

    expect(resolved).toHaveLength(2);
  });

  it("stays inert when timestamp resolving is unavailable", () => {
    const resolved: unknown[] = [];
    const renderer = {
      resolveTimestampsAsync: (query: unknown) => {
        resolved.push(query);
        return Promise.resolve();
      },
    };

    const timing = new GpuPassTiming(renderer as never, false, false);
    timing.update();

    expect(resolved).toHaveLength(0);
  });
});
