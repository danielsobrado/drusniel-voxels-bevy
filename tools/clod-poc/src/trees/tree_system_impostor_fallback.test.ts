import { describe, expect, it } from "vitest";
import {
  cloneTreeSettings,
  createTreeGeometryMap,
  disposeTreeGeometryMap,
  selectTreeSystemGeometry,
} from "./index.js";

describe("CPU tree impostor fallback", () => {
  it("keeps far geometry until a completed atlas is committed", () => {
    const settings = cloneTreeSettings();
    settings.impostors.enabled = true;
    settings.impostors.fallbackToPlaceholder = false;
    const geometries = createTreeGeometryMap(settings);

    try {
      const geometry = selectTreeSystemGeometry({
        species: "oak",
        lod: "impostor",
        settings,
        geometries,
        impostorAtlases: {},
        bakedImpostorGeometries: {},
      });
      expect(geometry).toBe(geometries.oak.far);
    } finally {
      disposeTreeGeometryMap(geometries);
    }
  });

  it("uses placeholder geometry only when explicitly enabled", () => {
    const settings = cloneTreeSettings();
    settings.impostors.enabled = true;
    settings.impostors.fallbackToPlaceholder = true;
    const geometries = createTreeGeometryMap(settings);

    try {
      const geometry = selectTreeSystemGeometry({
        species: "oak",
        lod: "impostor",
        settings,
        geometries,
        impostorAtlases: {},
        bakedImpostorGeometries: {},
      });
      expect(geometry).toBe(geometries.oak.impostor);
    } finally {
      disposeTreeGeometryMap(geometries);
    }
  });
});
