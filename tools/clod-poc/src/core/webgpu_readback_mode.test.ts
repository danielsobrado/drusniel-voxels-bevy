import { describe, expect, it } from "vitest";
import { parseReadbackMode, type WebGpuReadbackMode } from "./webgpu_readback_mode.js";

describe("parseReadbackMode", () => {
  it("returns async by default (no param)", () => {
    expect(parseReadbackMode(new URLSearchParams())).toBe("async");
  });

  it("returns async for empty string", () => {
    expect(parseReadbackMode(new URLSearchParams("webgpuReadback="))).toBe("async");
  });

  it("returns async for invalid values", () => {
    expect(parseReadbackMode(new URLSearchParams("webgpuReadback=bogus"))).toBe("async");
    expect(parseReadbackMode(new URLSearchParams("webgpuReadback=ONCE"))).toBe("async");
    expect(parseReadbackMode(new URLSearchParams("webgpuReadback=OFF"))).toBe("async");
  });

  it("returns off for 'off'", () => {
    expect(parseReadbackMode(new URLSearchParams("webgpuReadback=off"))).toBe("off");
  });

  it("returns once for 'once'", () => {
    expect(parseReadbackMode(new URLSearchParams("webgpuReadback=once"))).toBe("once");
  });

  it("returns async for 'async' explicitly", () => {
    expect(parseReadbackMode(new URLSearchParams("webgpuReadback=async"))).toBe("async");
  });

  it("accepts a raw search string", () => {
    expect(parseReadbackMode("webgpuReadback=off")).toBe("off");
  });
});

describe("WebGpuReadbackMode type", () => {
  it("only accepts the three valid modes", () => {
    const modes: WebGpuReadbackMode[] = ["async", "off", "once"];
    expect(modes).toHaveLength(3);
    expect(modes).toContain("async");
    expect(modes).toContain("off");
    expect(modes).toContain("once");
  });
});
