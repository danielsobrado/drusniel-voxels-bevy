import { describe, expect, it } from "vitest";
import {
  configureFarReflectionSource,
  readConfiguredFarReflectionSource,
} from "./far_reflection_source_config_runtime.js";

const config = {
  enabled: true,
  resolution: 65,
  spanM: 1024,
  snapM: 64,
  buildCellsPerFrame: 512,
};

describe("far reflection source config runtime", () => {
  it("uses identity-safe cleanup and returns defensive copies", () => {
    const releaseFirst = configureFarReflectionSource(config);
    const first = readConfiguredFarReflectionSource();
    expect(first).toEqual(config);
    expect(first).not.toBe(config);

    const releaseSecond = configureFarReflectionSource({ ...config, resolution: 33 });
    releaseFirst();
    expect(readConfiguredFarReflectionSource()?.resolution).toBe(33);

    releaseSecond();
    expect(readConfiguredFarReflectionSource()).toBeNull();
  });
});
