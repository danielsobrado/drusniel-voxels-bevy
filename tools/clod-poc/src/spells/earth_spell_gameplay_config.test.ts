import { describe, expect, it } from "vitest";
import {
  DEFAULT_EARTH_SPELL_GAMEPLAY_CONFIG,
  parseEarthSpellGameplayConfig,
} from "./earth_spell_gameplay_config.js";

describe("earth spell gameplay config", () => {
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
      command_expiry_ms: 450
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
      commandExpiryMs: 450,
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
      command_expiry_ms: 1
`);
    expect(config.operation).toBe(DEFAULT_EARTH_SPELL_GAMEPLAY_CONFIG.operation);
    expect(config.shape).toBe(DEFAULT_EARTH_SPELL_GAMEPLAY_CONFIG.shape);
    expect(config.radiusM).toBe(0.25);
    expect(config.strength).toBe(1);
    expect(config.commandExpiryMs).toBe(50);
  });
});
