import { describe, expect, it } from "vitest";
import { parseReadbackMode, type WebGpuReadbackMode } from "./webgpu_readback_mode.js";

describe("parseReadbackMode", () => {
  it("returns off by default", () => {
    expect(parseReadbackMode(new URLSearchParams())).toBe("off");
  });

  it("returns explicit modes", () => {
    expect(parseReadbackMode(new URLSearchParams("webgpuReadback=off"))).toBe("off");
    expect(parseReadbackMode(new URLSearchParams("webgpuReadback=once"))).toBe("once");
    expect(parseReadbackMode(new URLSearchParams("webgpuReadback=async"))).toBe("async");
  });
});

describe("WebGpuReadbackMode type", () => {
  it("only accepts the three valid modes", () => {
    const modes: WebGpuReadbackMode[] = ["async", "off", "once"];
    expect(modes).toHaveLength(3);
  });
});
