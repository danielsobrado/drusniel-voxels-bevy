import { compose, headlessIconData } from "./compose";
import { FALLBACK_RECIPE, ICON_RECIPES } from "./recipes";
import type { ClodIconKind, IconRecipe } from "./types";

// Icon compositor for CLOD UI controls.

export type { ClodIconKind } from "./types";

const DEFAULT_ICON_SIZE = 96;
const urlCache = new Map<string, string>();
const warnedIds = new Set<string>();

function isDev(): boolean {
  return Boolean(import.meta.env?.DEV);
}

function resolveRecipe(kind: ClodIconKind, id: string): IconRecipe {
  const recipe = ICON_RECIPES[kind]?.[id];
  if (recipe) return recipe;
  const warnKey = `${kind}/${id}`;
  if (isDev() && !warnedIds.has(warnKey)) {
    warnedIds.add(warnKey);
    console.warn(`[icons] no recipe for ${warnKey}; using fallback icon`);
  }
  return FALLBACK_RECIPE;
}

export function iconDataUrl(kind: ClodIconKind, id: string, size: number = DEFAULT_ICON_SIZE): string {
  const key = `${kind}|${id}|${size}`;
  const cached = urlCache.get(key);
  if (cached) return cached;

  const canvas = compose(resolveRecipe(kind, id), key, size);
  const url = canvas?.toDataURL("image/png") ?? headlessIconData(key);
  urlCache.set(key, url);
  return url;
}
