import { describe, expect, it } from "vitest";
import { FarReflectionSource } from "./far_reflection_source.js";
import {
  readActiveFarReflectionSource,
  readActiveFarReflectionSourceGeneration,
  registerActiveFarReflectionSource,
} from "./far_reflection_source_runtime.js";

function source(): FarReflectionSource {
  return new FarReflectionSource({
    enabled: true,
    resolution: 3,
    spanM: 2,
    snapM: 1,
    buildCellsPerFrame: 2,
  });
}

describe("far reflection source runtime", () => {
  it("uses identity-safe cleanup and a generation for authority replacement", () => {
    const initialGeneration = readActiveFarReflectionSourceGeneration();
    const first = source();
    const second = source();
    const unregisterFirst = registerActiveFarReflectionSource(first);
    expect(readActiveFarReflectionSource()).toBe(first);
    expect(readActiveFarReflectionSourceGeneration()).toBe(initialGeneration + 1);

    const unregisterSecond = registerActiveFarReflectionSource(second);
    expect(readActiveFarReflectionSource()).toBe(second);
    expect(readActiveFarReflectionSourceGeneration()).toBe(initialGeneration + 2);

    unregisterFirst();
    expect(readActiveFarReflectionSource()).toBe(second);
    expect(readActiveFarReflectionSourceGeneration()).toBe(initialGeneration + 2);

    unregisterSecond();
    expect(readActiveFarReflectionSource()).toBeNull();
    expect(readActiveFarReflectionSourceGeneration()).toBe(initialGeneration + 3);
  });
});
