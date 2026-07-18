import type { WaterEffectKey } from "./water_effects_runtime.js";

interface WaterEffectQuerySpec {
  primary: string;
  aliases: readonly string[];
}

export const WATER_EFFECT_QUERY_SPECS: Readonly<Record<WaterEffectKey, WaterEffectQuerySpec>> = {
  glacialMurkiness: { primary: "waterGlacialMurkiness", aliases: ["glacialWater", "waterGlacial"] },
  rockFlour: { primary: "waterRockFlour", aliases: ["rockFlourWater", "glacialRockFlour"] },
  reflectionTiers: { primary: "waterReflectionTiers", aliases: ["waterMidReflection", "waterReflectionFallback"] },
};

export function canonicalWaterEffectUrl(href: string, effect: WaterEffectKey, enabled: boolean): string {
  const url = new URL(href);
  const spec = WATER_EFFECT_QUERY_SPECS[effect];
  url.searchParams.set(spec.primary, enabled ? "1" : "0");
  for (const alias of spec.aliases) url.searchParams.delete(alias);
  return url.toString();
}

export function replaceWaterEffectUrl(effect: WaterEffectKey, enabled: boolean): void {
  const browser = globalThis as typeof globalThis & {
    location?: { href?: string };
    history?: { state?: unknown; replaceState?: (state: unknown, title: string, url?: string | URL | null) => void };
  };
  if (typeof browser.location?.href !== "string" || typeof browser.history?.replaceState !== "function") return;
  browser.history.replaceState(
    browser.history.state ?? null,
    "",
    canonicalWaterEffectUrl(browser.location.href, effect, enabled),
  );
}
