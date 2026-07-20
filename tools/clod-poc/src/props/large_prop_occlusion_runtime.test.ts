import { describe, expect, it } from "vitest";
import type { LargePropOcclusionField } from "./large_prop_occlusion_field.js";
import {
  readActiveLargePropOcclusionField,
  readActiveLargePropOcclusionFieldGeneration,
  registerActiveLargePropOcclusionField,
} from "./large_prop_occlusion_runtime.js";

describe("large prop occlusion runtime", () => {
  it("changes generation when authority is replaced or removed", () => {
    const first = {} as LargePropOcclusionField;
    const second = {} as LargePropOcclusionField;
    const before = readActiveLargePropOcclusionFieldGeneration();

    const unregisterFirst = registerActiveLargePropOcclusionField(first);
    const firstGeneration = readActiveLargePropOcclusionFieldGeneration();
    expect(firstGeneration).toBeGreaterThan(before);
    expect(readActiveLargePropOcclusionField()).toBe(first);

    const unregisterSecond = registerActiveLargePropOcclusionField(second);
    const secondGeneration = readActiveLargePropOcclusionFieldGeneration();
    expect(secondGeneration).toBeGreaterThan(firstGeneration);
    expect(readActiveLargePropOcclusionField()).toBe(second);

    unregisterFirst();
    expect(readActiveLargePropOcclusionField()).toBe(second);
    expect(readActiveLargePropOcclusionFieldGeneration()).toBe(secondGeneration);

    unregisterSecond();
    expect(readActiveLargePropOcclusionField()).toBeNull();
    expect(readActiveLargePropOcclusionFieldGeneration()).toBeGreaterThan(secondGeneration);
  });
});
