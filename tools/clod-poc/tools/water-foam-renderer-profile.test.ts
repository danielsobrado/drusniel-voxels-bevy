import { describe, expect, it } from "vitest";
import {
  applyWaterFoamRendererProfile,
  getWaterFoamRendererProfile,
  parseWaterFoamAcceptanceRenderer,
} from "./water-foam-renderer-profile.js";

describe("water foam renderer profiles", () => {
  it("parses stable renderer aliases", () => {
    expect(parseWaterFoamAcceptanceRenderer("webgpu")).toBe("webgpu");
    expect(parseWaterFoamAcceptanceRenderer("GPU")).toBe("webgpu");
    expect(parseWaterFoamAcceptanceRenderer("webgl")).toBe("webgl");
    expect(parseWaterFoamAcceptanceRenderer("gl")).toBe("webgl");
    expect(() => parseWaterFoamAcceptanceRenderer("auto")).toThrow(/unsupported water foam renderer/);
  });

  it("forces WebGL without leaving WebGPU selection enabled", () => {
    const result = new URL(applyWaterFoamRendererProfile(
      "http://127.0.0.1:5180/?renderer=webgpu&webgpuSelection=1",
      "webgl",
    ));

    expect(result.searchParams.get("renderer")).toBe("webgl");
    expect(result.searchParams.get("webgpuSelection")).toBe("0");
  });

  it("keeps WebGPU as the default matrix renderer", () => {
    expect(getWaterFoamRendererProfile("webgpu")).toMatchObject({
      renderer: "webgpu",
      outputSuffix: null,
    });
  });
});
