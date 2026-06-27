import { describe, expect, it } from "vitest";
import yamlText from "../../config/border_coast_ocean.yaml?raw";
import { DEFAULT_PLAYER_CONFIG } from "../player_controller.js";
import {
  parseBorderOceanGameplayConfig,
  resolvePlayerConfigForBorderOcean,
  validateBorderOceanGameplayConfig,
} from "./border_ocean_player_config.js";

describe("border ocean player config", () => {
  it("parses gameplay pushback from border ocean YAML", () => {
    const config = parseBorderOceanGameplayConfig(yamlText);

    expect(config).toEqual({
      softPushbackEnabled: true,
      worldEdgeMarginM: 16,
      pushbackStartInsideWorldM: 48,
      pushbackStrength: 36,
    });
  });

  it("maps gameplay config into player movement config", () => {
    const playerConfig = resolvePlayerConfigForBorderOcean(
      DEFAULT_PLAYER_CONFIG,
      {
        softPushbackEnabled: true,
        worldEdgeMarginM: 12,
        pushbackStartInsideWorldM: 80,
        pushbackStrength: 42,
      },
    );

    expect(playerConfig.worldEdgeMargin).toBe(12);
    expect(playerConfig.worldEdgePushbackBand).toBe(80);
    expect(playerConfig.worldEdgePushbackAcceleration).toBe(42);
    expect(playerConfig.walkSpeed).toBe(DEFAULT_PLAYER_CONFIG.walkSpeed);
  });

  it("can disable soft pushback while keeping the hard clamp margin", () => {
    const playerConfig = resolvePlayerConfigForBorderOcean(
      DEFAULT_PLAYER_CONFIG,
      {
        softPushbackEnabled: false,
        worldEdgeMarginM: 16,
        pushbackStartInsideWorldM: 0,
        pushbackStrength: 0,
      },
    );

    expect(playerConfig.worldEdgeMargin).toBe(16);
    expect(playerConfig.worldEdgePushbackBand).toBe(0);
    expect(playerConfig.worldEdgePushbackAcceleration).toBe(0);
  });

  it("fails when hard clamp margin is disabled", () => {
    expect(() =>
      validateBorderOceanGameplayConfig({
        softPushbackEnabled: false,
        worldEdgeMarginM: 0,
        pushbackStartInsideWorldM: 0,
        pushbackStrength: 0,
      }),
    ).toThrow("worldEdgeMarginM must be a finite number > 0");
  });

  it("fails when enabled soft pushback has no band", () => {
    expect(() =>
      validateBorderOceanGameplayConfig({
        softPushbackEnabled: true,
        worldEdgeMarginM: 16,
        pushbackStartInsideWorldM: 0,
        pushbackStrength: 36,
      }),
    ).toThrow("pushbackStartInsideWorldM must be > 0");
  });

  it("fails when enabled soft pushback has no acceleration", () => {
    expect(() =>
      validateBorderOceanGameplayConfig({
        softPushbackEnabled: true,
        worldEdgeMarginM: 16,
        pushbackStartInsideWorldM: 48,
        pushbackStrength: 0,
      }),
    ).toThrow("pushbackStrength must be > 0");
  });

  it("fails when gameplay parser sees malformed present fields", () => {
    expect(() =>
      parseBorderOceanGameplayConfig(
        yamlText.replace("world_edge_margin_m: 16", "world_edge_margin_m: nope"),
      ),
    ).toThrow("world_edge_margin_m must be a finite number");
  });

  it("fails when gameplay parser sees missing present fields", () => {
    expect(() =>
      parseBorderOceanGameplayConfig(
        yamlText.replace(/\n  pushback_strength: 36/, ""),
      ),
    ).toThrow("pushback_strength must be a finite number");
  });

  it("falls back to player defaults when gameplay config is absent", () => {
    const config = parseBorderOceanGameplayConfig("world: {}\n");

    expect(config.softPushbackEnabled).toBe(true);
    expect(config.worldEdgeMarginM).toBe(DEFAULT_PLAYER_CONFIG.worldEdgeMargin);
    expect(config.pushbackStartInsideWorldM).toBe(DEFAULT_PLAYER_CONFIG.worldEdgePushbackBand);
    expect(config.pushbackStrength).toBe(DEFAULT_PLAYER_CONFIG.worldEdgePushbackAcceleration);
  });
});
