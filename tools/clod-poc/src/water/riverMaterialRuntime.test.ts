import { describe, expect, it } from "vitest";
import {
  DEFAULT_RIVER_MATERIAL_SETTINGS,
  sanitizeRiverMaterialSettings,
} from "./riverMaterialRuntime.js";

describe("river material runtime settings", () => {
  it("keeps default river geometry and material values in safe ranges", () => {
    const settings = sanitizeRiverMaterialSettings(DEFAULT_RIVER_MATERIAL_SETTINGS);

    expect(settings.geometryThalwegDip).toBeGreaterThan(0);
    expect(settings.geometryBankLift).toBeGreaterThan(0);
    expect(settings.geometryRiffleStrength).toBeGreaterThan(0);
    expect(settings.geometryMaxOffset).toBeGreaterThanOrEqual(settings.geometryThalwegDip);
    expect(settings.cascadeDropStart).toBeGreaterThanOrEqual(0);
    expect(settings.cascadeDropEnd).toBeGreaterThan(settings.cascadeDropStart);
    expect(settings.cascadeStepStrength).toBeGreaterThan(0);
    expect(settings.cascadeRoughnessStrength).toBeGreaterThan(0);
    expect(settings.cascadeWhitewaterBoost).toBeGreaterThan(0);
    expect(settings.wetBankStrength).toBeGreaterThan(0);
    expect(settings.wetBankDistanceM).toBeGreaterThan(0);
    expect(settings.wetRockDarkening).toBeGreaterThan(0);
    expect(settings.foamResidueStrength).toBeGreaterThan(0);
    expect(settings.foamResidueDropStart).toBeGreaterThanOrEqual(0);
    expect(settings.flowNormalStrength).toBeGreaterThan(0);
    expect(settings.crossCurrentStrength).toBeGreaterThan(0);
    expect(settings.rapidNormalBoost).toBeGreaterThan(0);
    expect(settings.bankFoamStrength).toBeGreaterThan(0);
    expect(settings.rapidFoamStrength).toBeGreaterThan(0);
    expect(settings.foamStreakStrength).toBeGreaterThan(0);
    expect(settings.shallowBankTintStrength).toBeGreaterThan(0);
    expect(settings.centerChannelDarkening).toBeGreaterThan(0);
  });

  it("clamps unsafe URL values before they reach geometry or shader code", () => {
    const settings = sanitizeRiverMaterialSettings({
      geometryThalwegDip: -10,
      geometryBankLift: 10,
      geometryRiffleStrength: 10,
      geometrySideRiffleStrength: 10,
      geometryMaxOffset: 10,
      cascadeDropStart: 10,
      cascadeDropEnd: 0.01,
      cascadeStepStrength: 10,
      cascadeRoughnessStrength: 10,
      cascadeWhitewaterBoost: 10,
      wetBankStrength: 10,
      wetBankDistanceM: -1,
      wetRockDarkening: 10,
      foamResidueStrength: 10,
      foamResidueDropStart: 10,
      flowNormalStrength: 10,
      crossCurrentStrength: -2,
      rapidNormalBoost: 10,
      bankFoamStrength: 10,
      rapidFoamStrength: -1,
      foamStreakStrength: Number.NaN,
      shallowBankTintStrength: 10,
      centerChannelDarkening: -5,
      foamResidueDropEnd: -1,
      bankNormalStrength: 10,
      rapidScale: 10,
    });

    expect(settings.geometryThalwegDip).toBe(0);
    expect(settings.geometryBankLift).toBe(0.25);
    expect(settings.geometryRiffleStrength).toBe(0.30);
    expect(settings.geometrySideRiffleStrength).toBe(0.20);
    expect(settings.geometryMaxOffset).toBe(0.60);
    expect(settings.cascadeDropStart).toBe(8);
    expect(settings.cascadeDropEnd).toBe(8.05);
    expect(settings.cascadeStepStrength).toBe(0.60);
    expect(settings.cascadeRoughnessStrength).toBe(0.40);
    expect(settings.cascadeWhitewaterBoost).toBe(5);
    expect(settings.wetBankStrength).toBe(2);
    expect(settings.wetBankDistanceM).toBe(0.5);
    expect(settings.wetRockDarkening).toBe(1);
    expect(settings.foamResidueStrength).toBe(2);
    expect(settings.foamResidueDropStart).toBe(8);
    expect(settings.flowNormalStrength).toBe(4);
    expect(settings.crossCurrentStrength).toBe(0);
    expect(settings.rapidNormalBoost).toBe(4);
    expect(settings.bankFoamStrength).toBe(3);
    expect(settings.rapidFoamStrength).toBe(0);
    expect(settings.foamStreakStrength).toBe(DEFAULT_RIVER_MATERIAL_SETTINGS.foamStreakStrength);
    expect(settings.shallowBankTintStrength).toBe(3);
    expect(settings.centerChannelDarkening).toBe(0);
  });
});
