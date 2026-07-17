import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePhase0Config } from "./phase0_config.js";

const PAGE_SIZE_M = 64;

function bundledConfig() {
  const path = resolve(import.meta.dirname ?? ".", "../../config/infinite_streaming_phase0.yaml");
  return parsePhase0Config(readFileSync(path, "utf8"));
}

describe("RPG density phase0 profiles", () => {
  it.each([
    ["rpg_village", 1600, 500],
    ["rpg_player_base", 1900, 650],
  ] as const)("targets the %s route coordinates", (key, expectedX, expectedZ) => {
    const scene = bundledConfig().phase0.scenes[key];
    const worldCells = scene.world * PAGE_SIZE_M;

    expect(scene.camera.mode).toBe("fixed");
    expect(worldCells).toBe(2048);
    expect(worldCells * (scene.camera.x_ratio ?? 0)).toBe(expectedX);
    expect(worldCells * (scene.camera.z_ratio ?? 0)).toBe(expectedZ);
  });
});
