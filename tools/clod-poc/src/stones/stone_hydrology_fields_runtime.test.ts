import { afterEach, describe, expect, it } from "vitest";
import {
  readStoneHydrologyFieldsData,
  setStoneHydrologyFieldsData,
} from "./stone_hydrology_fields_runtime.js";

afterEach(() => setStoneHydrologyFieldsData(null));

describe("stone hydrology fields runtime", () => {
  it("publishes the canonical Layout B data without copying", () => {
    const data = { res: 2, worldCells: 16, data: new Float32Array(16) };
    setStoneHydrologyFieldsData(data);
    expect(readStoneHydrologyFieldsData()).toBe(data);
  });

  it("can clear stale authority data", () => {
    setStoneHydrologyFieldsData({ res: 1, worldCells: 1, data: new Float32Array(4) });
    setStoneHydrologyFieldsData(null);
    expect(readStoneHydrologyFieldsData()).toBeNull();
  });
});
