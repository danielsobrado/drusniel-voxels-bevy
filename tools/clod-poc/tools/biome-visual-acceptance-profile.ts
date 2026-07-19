export const BIOME_VISUAL_SEASONS = ["winter", "spring", "summer", "autumn"] as const;

export type BiomeVisualSeason = typeof BIOME_VISUAL_SEASONS[number];

export interface BiomeVisualSeasonProfile {
  readonly name: BiomeVisualSeason;
  readonly seasonT: number;
  readonly expected: {
    readonly green: number;
    readonly autumn: number;
    readonly bloom: number;
    readonly snowlineM: number;
    readonly frostAmount: number;
  };
}

export const BIOME_VISUAL_SEASON_PROFILES: Readonly<Record<BiomeVisualSeason, BiomeVisualSeasonProfile>> = Object.freeze({
  winter: Object.freeze({
    name: "winter",
    seasonT: 0,
    expected: Object.freeze({ green: 0.20, autumn: 0, bloom: 0, snowlineM: 900, frostAmount: 0.95 }),
  }),
  spring: Object.freeze({
    name: "spring",
    seasonT: 0.25,
    expected: Object.freeze({ green: 0.82, autumn: 0, bloom: 1, snowlineM: 1500, frostAmount: 0.18 }),
  }),
  summer: Object.freeze({
    name: "summer",
    seasonT: 0.50,
    expected: Object.freeze({ green: 1, autumn: 0, bloom: 0.32, snowlineM: 2300, frostAmount: 0 }),
  }),
  autumn: Object.freeze({
    name: "autumn",
    seasonT: 0.75,
    expected: Object.freeze({ green: 0.46, autumn: 1, bloom: 0, snowlineM: 1350, frostAmount: 0.42 }),
  }),
});

export function buildBiomeVisualAcceptanceUrl(
  baseUrl: string,
  seed: string,
  world: number,
  season: BiomeVisualSeason,
): string {
  const profile = BIOME_VISUAL_SEASON_PROFILES[season];
  const url = new URL(baseUrl);
  url.searchParams.set("scene", "infinite-islands");
  url.searchParams.set("seed", seed);
  url.searchParams.set("world", String(world));
  url.searchParams.set("startupWorld", "4");
  url.searchParams.set("infiniteStartupWorld", "4");
  url.searchParams.set("acceptance", "1");
  url.searchParams.set("webgpuSelection", "1");
  url.searchParams.set("farShell", "1");
  url.searchParams.set("farClipmap", "1");
  url.searchParams.set("canopy", "1");
  url.searchParams.set("weather", "off");
  url.searchParams.set("biomeSeasonT", String(profile.seasonT));
  return url.toString();
}
