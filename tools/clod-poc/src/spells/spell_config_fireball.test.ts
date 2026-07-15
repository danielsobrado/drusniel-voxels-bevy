import { describe, expect, it } from "vitest";
import { defaultSpellConfig, parseSpellConfig } from "./spell_config.js";

describe("fireball spell config", () => {
  it("loads a usable sixth spell from the checked-in YAML", () => {
    expect(defaultSpellConfig.fireball.id).toBe("fireball");
    expect(defaultSpellConfig.fireball.label).toBe("Fireball");
    expect(defaultSpellConfig.fireball.vfx.launchSpeed).toBeGreaterThan(0);
    expect(defaultSpellConfig.fireball.vfx.gravity).toBeGreaterThan(0);
    expect(defaultSpellConfig.fireball.vfx.projectileRadius).toBeGreaterThan(0);
    expect(defaultSpellConfig.fireball.vfx.impactDurationMs).toBeLessThan(defaultSpellConfig.fireball.castDurationMs);
  });

  it("parses and clamps fireball physics values", () => {
    const config = parseSpellConfig(`
spells:
  fireball:
    label: Meteor
    cast_duration_ms: 5000
    audio:
      volume: 2
    vfx:
      launch_speed: 999
      lift_speed: -999
      gravity: -1
      projectile_radius: 99
      impact_duration_ms: 900
      trail_count: 999
      spark_count: -2
`);

    expect(config.fireball.label).toBe("Meteor");
    expect(config.fireball.audio.volume).toBe(1);
    expect(config.fireball.vfx.launchSpeed).toBe(80);
    expect(config.fireball.vfx.liftSpeed).toBe(-20);
    expect(config.fireball.vfx.gravity).toBe(0);
    expect(config.fireball.vfx.projectileRadius).toBe(3);
    expect(config.fireball.vfx.impactDurationMs).toBe(900);
    expect(config.fireball.vfx.trailCount).toBe(64);
    expect(config.fireball.vfx.sparkCount).toBe(0);
  });
});
