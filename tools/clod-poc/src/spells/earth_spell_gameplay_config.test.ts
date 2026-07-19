import { describe, expect, it } from "vitest";
import {
  DEFAULT_EARTH_SPELL_GAMEPLAY_CONFIG,
  parseEarthSpellGameplayConfig,
} from "./earth_spell_gameplay_config.js";

describe("earth spell gameplay config", () => {
  it("reaches the canonical 7.5 metre riverbed from a surface-swimming camera", () => {
    const config = parseEarthSpellGameplayConfig();
    expect(config.maxRangeM).toBe(10);
    expect(config.maxRangeM).toBeGreaterThan(7.5 + 1.1);
    expect(DEFAULT_EARTH_SPELL_GAMEPLAY_CONFIG.maxRangeM).toBe(10);
  });

  it("reads terrain mutation settings from YAML", () => {
    const config = parseEarthSpellGameplayConfig(`
spells:
  earth:
    gameplay:
      terrain_edit_enabled: true
      operation: add
      shape: cylinder
      radius_m: 3.5
      height_m: 1.25
      strength: 0.6
      falloff: 0.2
      material: 7
      max_range_m: 9
      command_expiry_ms: 450
      convergence_timeout_ms: 2500
`);
    expect(config).toEqual({
      enabled: true,
      operation: "add",
      shape: "cylinder",
      radiusM: 3.5,
      heightM: 1.25,
      strength: 0.6,
      falloff: 0.2,
      material: 7,
      maxRangeM: 9,
      commandExpiryMs: 450,
      convergenceTimeoutMs: 2500,
    });
  });

  it("clamps invalid values and preserves safe defaults", () => {
    const config = parseEarthSpellGameplayConfig(`
spells:
  earth:
    gameplay:
      operation: invalid
      shape: invalid
      radius_m: -10
      strength: 5
      max_range_m: 500
      command_expiry_ms: 1
      convergence_timeout_ms: 999999
`);
    expect(config.operation).toBe(DEFAULT_EARTH_SPELL_GAMEPLAY_CONFIG.operation);
    expect(config.shape).toBe(DEFAULT_EARTH_SPELL_GAMEPLAY_CONFIG.shape);
    expect(config.radiusM).toBe(0.25);
    expect(config.strength).toBe(1);
    expect(config.maxRangeM).toBe(80);
    expect(config.commandExpiryMs).toBe(50);
    expect(config.convergenceTimeoutMs).toBe(30000);
  });
});
