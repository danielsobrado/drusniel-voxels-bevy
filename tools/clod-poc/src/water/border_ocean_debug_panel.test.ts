import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DEFAULT_BORDER_COAST_OCEAN_CONFIG } from "../terrain/border_coast_config.js";
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

  it("builds a snapshot from config and sampler state", () => {
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
    });

    expect(snapshot.zone).toBe("deep-ocean-ring");
    expect(snapshot.meshPresent).toBe(true);
    expect(snapshot.samplerValidHere).toBe(true);
    expect(snapshot.waveCount).toBeGreaterThan(0);
    expect(snapshot.windSpeed).toBe(deepOcean.wave.windSpeed);
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
    });

    expect(lines).toContain("zone: transition-gap");
    expect(lines).toContain("sampler: yes valid-here=no");
    expect(lines).toContain("waves: 54 wind=14.0");
  });
});
