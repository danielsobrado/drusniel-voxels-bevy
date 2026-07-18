import { describe, expect, it } from "vitest";
import {
  applyProjectGeneratorQuery,
  captureProjectGeneratorQuery,
  validateProjectGeneratorQuery,
} from "./project_world_identity.js";

describe("project generator query identity", () => {
  it("captures only allowlisted generation-affecting parameters", () => {
    const params = new URLSearchParams(
      "water=1&quality=perf&continentHydrology=0&heightfieldRaster=1&hud=1&x=20",
    );
    expect(captureProjectGeneratorQuery(params)).toEqual({
      water: "1",
      quality: "perf",
      continentHydrology: "0",
      heightfieldRaster: "1",
    });
  });

  it("clears stale aliases before applying the archived values", () => {
    const params = new URLSearchParams(
      "waterEnabled=0&waterPerf=1&hydroUnifiedStartup=0&hud=1",
    );
    applyProjectGeneratorQuery(params, {
      water: "1",
      hydroUnified: "1",
    });
    expect(params.get("water")).toBe("1");
    expect(params.get("hydroUnified")).toBe("1");
    expect(params.get("waterEnabled")).toBeNull();
    expect(params.get("waterPerf")).toBeNull();
    expect(params.get("hydroUnifiedStartup")).toBeNull();
    expect(params.get("hud")).toBe("1");
  });

  it("rejects unsupported keys and control characters", () => {
    expect(() => validateProjectGeneratorQuery({ arbitrary: "1" }))
      .toThrow(/unsupported key/i);
    expect(() => validateProjectGeneratorQuery({ water: "1\nmalformed" }))
      .toThrow(/control characters/i);
  });
});
