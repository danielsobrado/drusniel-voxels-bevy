import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { DEFAULT_FOREST_LIGHTING_SETTINGS } from "./forest_lighting_config.js";
import {
  createForestLightingField,
  finalizeForestLightingField,
  splatCanopyInfluence,
  splatUnderstoryInfluence,
} from "./forest_lighting_fields.js";

describe("forest lighting ecology field", () => {
  it("derives species coverage, height, competition, and grass suppression from accepted proxies", () => {
    const settings = {
      ...DEFAULT_FOREST_LIGHTING_SETTINGS,
      field: { ...DEFAULT_FOREST_LIGHTING_SETTINGS.field, resolution: 8 },
      atmosphere: { ...DEFAULT_FOREST_LIGHTING_SETTINGS.atmosphere, forestFogHeightM: 20 },
    };
    const field = createForestLightingField(80, settings);

    splatCanopyInfluence(field, {
      x: 40,
      z: 40,
      height: 16,
      scale: 1,
      crownRadius: 7,
      species: "oak",
    }, settings);
    splatCanopyInfluence(field, {
      x: 50,
      z: 40,
      height: 18,
      scale: 1,
      crownRadius: 7,
      species: "spruce",
    }, settings);
    splatUnderstoryInfluence(field, {
      x: 40,
      z: 40,
      classId: "fern",
      scale: 1,
      densityWeight: 0.8,
    }, settings);
    finalizeForestLightingField(field, new THREE.Vector3(1, 1, 0), settings);

    expect(Math.max(...field.canopyHeightM)).toBeGreaterThan(0);
    expect(Math.max(...field.broadleafCoverage)).toBeGreaterThan(0);
    expect(Math.max(...field.coniferCoverage)).toBeGreaterThan(0);
    expect(Math.max(...field.competition)).toBeGreaterThan(0);
    expect(Math.max(...field.grassSuppression)).toBeGreaterThan(0);
    expect(Math.max(...field.grassSuppression)).toBeLessThanOrEqual(1);
  });
});
