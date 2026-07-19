export const WATER_FOAM_ACCEPTANCE_QUALITIES = ["high", "low"] as const;

export type WaterFoamAcceptanceQuality = typeof WATER_FOAM_ACCEPTANCE_QUALITIES[number];

export interface WaterFoamAcceptanceProfile {
  readonly quality: WaterFoamAcceptanceQuality;
  readonly outputFolder: string;
  readonly query: Readonly<Record<string, string>>;
}

const PROFILE_BY_QUALITY: Readonly<Record<WaterFoamAcceptanceQuality, WaterFoamAcceptanceProfile>> = Object.freeze({
  high: Object.freeze({
    quality: "high",
    outputFolder: "high",
    query: Object.freeze({ waterQuality: "high", waterPerf: "0" }),
  }),
  low: Object.freeze({
    quality: "low",
    outputFolder: "low",
    query: Object.freeze({ waterQuality: "low", waterPerf: "1" }),
  }),
});

export function parseWaterFoamAcceptanceQuality(value: string): WaterFoamAcceptanceQuality {
  const normalized = value.trim().toLowerCase();
  if (normalized === "high" || normalized === "hq") return "high";
  if (normalized === "low" || normalized === "perf" || normalized === "performance") return "low";
  throw new Error(`unknown foam acceptance quality: ${value}; expected high or low`);
}

export function getWaterFoamAcceptanceProfile(
  quality: WaterFoamAcceptanceQuality,
): WaterFoamAcceptanceProfile {
  return PROFILE_BY_QUALITY[quality];
}

export function buildWaterFoamAcceptanceUrl(
  baseUrl: string,
  seed: string,
  world: number,
  quality: WaterFoamAcceptanceQuality,
): string {
  const profile = getWaterFoamAcceptanceProfile(quality);
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
  url.searchParams.set("waterDebug", "1");
  for (const [key, value] of Object.entries(profile.query)) url.searchParams.set(key, value);
  return url.toString();
}
