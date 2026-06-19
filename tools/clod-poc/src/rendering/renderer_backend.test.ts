import { describe, expect, it } from "vitest";
import { parseRendererBackend } from "./renderer_backend.js";

describe("parseRendererBackend", () => {
  it("defaults to WebGPU", () => {
    expect(parseRendererBackend(new URLSearchParams())).toBe("webgpu");
  });

  it("keeps explicit WebGL fallback", () => {
    expect(parseRendererBackend(new URLSearchParams("renderer=webgl"))).toBe("webgl");
  });

  it("uses WebGPU for explicit WebGPU and unknown values", () => {
    expect(parseRendererBackend(new URLSearchParams("renderer=webgpu"))).toBe("webgpu");
    expect(parseRendererBackend(new URLSearchParams("renderer=bogus"))).toBe("webgpu");
  });
});
