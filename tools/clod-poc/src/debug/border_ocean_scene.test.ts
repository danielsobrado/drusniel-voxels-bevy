import { describe, expect, it } from "vitest";
import {
  borderOceanCameraForWorld,
  formatBorderOceanCamString,
  parseBorderOceanCamString,
  parseBorderOceanSceneConfig,
} from "./border_ocean_scene.js";
import borderOceanSceneYaml from "../../config/border_ocean_scene.yaml?raw";

describe("border-ocean scene", () => {
  it("parses scene config defaults", () => {
    const cfg = parseBorderOceanSceneConfig(borderOceanSceneYaml);
    expect(cfg.defaultWorldPages).toBe(16);
    expect(cfg.acceptance.minDeepOceanVertices).toBeGreaterThan(0);
  });

  it("builds inland-to-coast camera looking past the south edge", () => {
    const worldCells = 1024;
    const cam = borderOceanCameraForWorld(worldCells);
    expect(cam.eye[2]).toBeLessThan(cam.look[2]);
    expect(cam.look[2]).toBeGreaterThan(worldCells);
    expect(cam.eye[1]).toBeGreaterThan(cam.look[1]);
  });

  it("round-trips cam string eye/look format", () => {
    const worldCells = 1024;
    const formatted = formatBorderOceanCamString(borderOceanCameraForWorld(worldCells));
    const parsed = parseBorderOceanCamString(formatted, worldCells);
    expect(parsed.eye[0]).toBeCloseTo(512, 0);
    expect(parsed.look[2]).toBeGreaterThan(worldCells);
  });
});
