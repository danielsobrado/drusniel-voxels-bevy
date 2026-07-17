import { describe, expect, it } from "vitest";
import {
  buildRpgDensityComposition,
  RPG_PLAYER_BASE_SCENE,
  RPG_VILLAGE_SCENE,
} from "./rpg_density_scene_composition.js";

const HEIGHT = (x: number, z: number): number => 20 + x * 0.0001 + z * 0.0002;

describe("RPG density scene composition", () => {
  it("is byte-stable for the same scene and seed", () => {
    const first = buildRpgDensityComposition({ sceneId: RPG_VILLAGE_SCENE, seed: 42, surfaceHeightAt: HEIGHT });
    const second = buildRpgDensityComposition({ sceneId: RPG_VILLAGE_SCENE, seed: 42, surfaceHeightAt: HEIGHT });

    expect(second).toEqual(first);
  });

  it("changes deterministic placement when the seed changes", () => {
    const first = buildRpgDensityComposition({ sceneId: RPG_VILLAGE_SCENE, seed: 42, surfaceHeightAt: HEIGHT });
    const second = buildRpgDensityComposition({ sceneId: RPG_VILLAGE_SCENE, seed: 43, surfaceHeightAt: HEIGHT });

    expect(second.pieces).not.toEqual(first.pieces);
    expect(second.propScene.instances).not.toEqual(first.propScene.instances);
  });

  it("builds a village inside the planned density ranges", () => {
    const composition = buildRpgDensityComposition({ sceneId: RPG_VILLAGE_SCENE, seed: 7, surfaceHeightAt: HEIGHT });

    expect(composition.summary.buildingCount).toBe(40);
    expect(composition.summary.constructionPiecesTotal).toBeGreaterThanOrEqual(1500);
    expect(composition.summary.constructionPiecesTotal).toBeLessThanOrEqual(4000);
    expect(composition.summary.placedProps).toBe(400);
    expect(composition.summary.averagePiecesPerBuilding).toBeGreaterThan(0);
    expect(composition.summary.maxPiecesPerBuilding).toBeGreaterThanOrEqual(composition.summary.averagePiecesPerBuilding);
  });

  it("builds the player base inside the planned piece range", () => {
    const composition = buildRpgDensityComposition({ sceneId: RPG_PLAYER_BASE_SCENE, seed: 7, surfaceHeightAt: HEIGHT });

    expect(composition.summary.buildingCount).toBe(1);
    expect(composition.summary.constructionPiecesTotal).toBeGreaterThanOrEqual(200);
    expect(composition.summary.constructionPiecesTotal).toBeLessThanOrEqual(600);
    expect(composition.summary.placedProps).toBe(100);
  });

  it("emits unique ids and coherent support references", () => {
    for (const sceneId of [RPG_VILLAGE_SCENE, RPG_PLAYER_BASE_SCENE] as const) {
      const composition = buildRpgDensityComposition({ sceneId, seed: 17, surfaceHeightAt: HEIGHT });
      const ids = new Set(composition.pieces.map((piece) => piece.id));

      expect(ids.size).toBe(composition.pieces.length);
      for (const placed of composition.pieces) {
        expect(placed.id).not.toEqual("");
        expect(placed.connectionIds).not.toContain(placed.id);
        for (const connectionId of placed.connectionIds ?? []) expect(ids.has(connectionId)).toBe(true);
        expect(placed.position.every(Number.isFinite)).toBe(true);
      }
    }
  });

  it("keeps the village road axes and player-base footprint clear of props", () => {
    const village = buildRpgDensityComposition({ sceneId: RPG_VILLAGE_SCENE, seed: 9, surfaceHeightAt: HEIGHT });
    for (const prop of village.propScene.instances) {
      const dx = Math.abs(prop.position[0] - village.center.x);
      const dz = Math.abs(prop.position[2] - village.center.z);
      expect(dx > 9 && dz > 9).toBe(true);
    }

    const base = buildRpgDensityComposition({ sceneId: RPG_PLAYER_BASE_SCENE, seed: 9, surfaceHeightAt: HEIGHT });
    for (const prop of base.propScene.instances) {
      const dx = Math.abs(prop.position[0] - base.center.x);
      const dz = Math.abs(prop.position[2] - base.center.z);
      expect(dx > 24 || dz > 24).toBe(true);
    }
  });
});
