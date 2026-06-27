import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DEFAULT_BORDER_COAST_OCEAN_CONFIG } from "../terrain/border_coast_config.js";
import { DEFAULT_PLAYER_CONFIG } from "../player_controller.js";
import {
  buildBorderOceanDebugSnapshot,
  classifyBorderOceanZone,
  formatBorderOceanDebug,
} from "./border_ocean_debug_panel.js";
import { createDeepOceanSampler } from "./ocean_service.js";

describe("border ocean debug panel helpers", () => {
  it("classifies playable, transition, deep ocean, and outside zones", () => {
    expect(classifyBorderOceanZone(128, 128, 256, 64, 128)).toBe("playable");
    expect(classifyBorderOceanZone(300, 128, 256, 64, 128)).toBe("transition-gap");
    expect(classifyBorderOceanZone(321, 128, 256, 64, 128)).toBe("deep-ocean-ring");
    expect(classifyBorderOceanZone(500, 128, 256, 64, 128)).toBe("outside-visual-extent");
  });

  it("builds a snapshot from config, sampler, and player boundary state", () => {
    const deepOcean = {
      ...DEFAULT_BORDER_COAST_OCEAN_CONFIG.deepOcean,
      startOutsideBorderM: 64,
      extendCells: 128,
    };
    const sampler = createDeepOceanSampler(256, deepOcean);
    const snapshot = buildBorderOceanDebugSnapshot({
      worldCells: 256,
      cameraPosition: new THREE.Vector3(321, 18, 128),
      deepOcean,
      deepOceanMeshPresent: true,
      oceanSampler: sampler,
      playerConfig: DEFAULT_PLAYER_CONFIG,
    });

    expect(snapshot.zone).toBe("deep-ocean-ring");
    expect(snapshot.meshPresent).toBe(true);
    expect(snapshot.samplerValidHere).toBe(true);
    expect(snapshot.waveCount).toBeGreaterThan(0);
    expect(snapshot.windSpeed).toBe(deepOcean.wave.windSpeed);
    expect(snapshot.playerMarginM).toBe(DEFAULT_PLAYER_CONFIG.worldEdgeMargin);
    expect(snapshot.pushbackBandM).toBe(DEFAULT_PLAYER_CONFIG.worldEdgePushbackBand);
    expect(snapshot.pushbackAcceleration).toBe(DEFAULT_PLAYER_CONFIG.worldEdgePushbackAcceleration);
    expect(snapshot.softPushbackEnabled).toBe(true);
  });

  it("formats stable debug lines", () => {
    const lines = formatBorderOceanDebug({
      enabled: true,
      zone: "transition-gap",
      cameraX: 300,
      cameraZ: 128,
      worldCells: 256,
      startOutsideBorderM: 64,
      extendCells: 128,
      meshPresent: true,
      samplerPresent: true,
      samplerValidHere: false,
      waveCount: 54,
      windSpeed: 14,
      heightScale: 1.3,
      choppiness: 1.6,
      fogFarM: 1800,
      reflectionStrength: 0.46,
      playerMarginM: 16,
      pushbackBandM: 48,
      pushbackAcceleration: 36,
      softPushbackEnabled: true,
    });

    expect(lines).toContain("zone: transition-gap");
    expect(lines).toContain("sampler: yes valid-here=no");
    expect(lines).toContain("pushback: yes band=48.0m");
    expect(lines).toContain("clamp margin: 16.0m accel=36.0");
    expect(lines).toContain("waves: 54 wind=14.0");
  });
});
