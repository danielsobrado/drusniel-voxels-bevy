import { describe, expect, it } from "vitest";
import {
  DEFAULT_RIVER_CASCADE_PARTICLE_SETTINGS,
  sanitizeRiverCascadeParticleSettings,
} from "./riverCascadeParticlesRuntime.js";

describe("river cascade particle runtime settings", () => {
  it("keeps default settings inside safe ranges", () => {
    const settings = sanitizeRiverCascadeParticleSettings(DEFAULT_RIVER_CASCADE_PARTICLE_SETTINGS);

    expect(settings.enabled).toBe(true);
    expect(settings.mistStrength).toBeGreaterThan(0);
    expect(settings.splashStrength).toBeGreaterThan(0);
    expect(settings.rapidDropletStrength).toBeGreaterThan(0);
    expect(settings.foamDriftStrength).toBeGreaterThan(0);
    expect(settings.spawnRadiusM).toBeGreaterThanOrEqual(16);
    expect(settings.maxEmittersPerTick).toBeGreaterThanOrEqual(4);
    expect(settings.rapidSpeedEnd).toBeGreaterThan(settings.rapidSpeedStart);
    expect(settings.rapidDropletThreshold).toBeGreaterThan(0);
    expect(settings.rapidDropletsPerEmitter).toBeGreaterThanOrEqual(1);
    expect(settings.rapidDropletGravity).toBeGreaterThan(0);
    expect(settings.dropEnd).toBeGreaterThan(settings.dropStart);
  });

  it("clamps unsafe values", () => {
    const settings = sanitizeRiverCascadeParticleSettings({
      enabled: false,
      mistStrength: -1,
      splashStrength: 10,
      rapidDropletStrength: -3,
      foamDriftStrength: Number.NaN,
      spawnRadiusM: 10000,
      maxEmittersPerTick: 10000,
      rapidSpeedStart: 20,
      rapidSpeedEnd: 0.01,
      rapidDropletThreshold: 4,
      rapidDropletsPerEmitter: 100,
      rapidDropletGravity: Number.NaN,
      dropStart: 20,
      dropEnd: 0.01,
    });

    expect(settings.enabled).toBe(false);
    expect(settings.mistStrength).toBe(0);
    expect(settings.splashStrength).toBe(3);
    expect(settings.rapidDropletStrength).toBe(0);
    expect(settings.foamDriftStrength).toBe(DEFAULT_RIVER_CASCADE_PARTICLE_SETTINGS.foamDriftStrength);
    expect(settings.spawnRadiusM).toBe(180);
    expect(settings.maxEmittersPerTick).toBe(80);
    expect(settings.rapidSpeedStart).toBe(8);
    expect(settings.rapidSpeedEnd).toBe(8.05);
    expect(settings.rapidDropletThreshold).toBe(0.95);
    expect(settings.rapidDropletsPerEmitter).toBe(4);
    expect(settings.rapidDropletGravity).toBe(DEFAULT_RIVER_CASCADE_PARTICLE_SETTINGS.rapidDropletGravity);
    expect(settings.dropStart).toBe(12);
    expect(settings.dropEnd).toBe(12.05);
  });
});
