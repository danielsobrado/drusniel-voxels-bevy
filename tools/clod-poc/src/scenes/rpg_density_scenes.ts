export const RPG_VILLAGE_SCENE = "rpg-village";
export const RPG_PLAYER_BASE_SCENE = "rpg-player-base";

export type RpgDensitySceneId = typeof RPG_VILLAGE_SCENE | typeof RPG_PLAYER_BASE_SCENE;

export interface RpgDensitySceneCenter {
  readonly x: number;
  readonly z: number;
}

export const RPG_VILLAGE_CENTER: RpgDensitySceneCenter = Object.freeze({ x: 1600, z: 500 });
export const RPG_PLAYER_BASE_CENTER: RpgDensitySceneCenter = Object.freeze({ x: 1900, z: 650 });

export function isRpgDensityScene(scene: string | null): scene is RpgDensitySceneId {
  return scene === RPG_VILLAGE_SCENE || scene === RPG_PLAYER_BASE_SCENE;
}

export function rpgDensitySceneCenter(scene: RpgDensitySceneId): RpgDensitySceneCenter {
  return scene === RPG_VILLAGE_SCENE ? RPG_VILLAGE_CENTER : RPG_PLAYER_BASE_CENTER;
}
