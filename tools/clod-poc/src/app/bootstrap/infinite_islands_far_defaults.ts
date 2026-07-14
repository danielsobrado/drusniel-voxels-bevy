const INFINITE_ISLANDS_SCENE = "infinite-islands";
const UNIFIED_FAR_SUMMARY_LAYOUT = "2";
const FAR_CLIPMAP_ENABLED = "1";
const FAR_CLIPMAP_REPLACE_MODE = "replace";

function setDefault(params: URLSearchParams, key: string, value: string): boolean {
  if (params.has(key)) return false;
  params.set(key, value);
  return true;
}

export function applyInfiniteIslandsFarDefaults(params: URLSearchParams): boolean {
  if (params.get("scene") !== INFINITE_ISLANDS_SCENE) return false;

  let changed = setDefault(params, "farSummaryLayout", UNIFIED_FAR_SUMMARY_LAYOUT);
  if (params.get("farSummaryLayout") !== UNIFIED_FAR_SUMMARY_LAYOUT) {
    syncBrowserSearch(params, changed);
    return changed;
  }

  changed = setDefault(params, "farClipmap", FAR_CLIPMAP_ENABLED) || changed;
  if (params.get("farClipmap") === FAR_CLIPMAP_ENABLED) {
    changed = setDefault(params, "farClipmapMode", FAR_CLIPMAP_REPLACE_MODE) || changed;
  }

  syncBrowserSearch(params, changed);
  return changed;
}

function syncBrowserSearch(params: URLSearchParams, changed: boolean): void {
  if (!changed || typeof window === "undefined" || typeof history === "undefined") return;
  const url = new URL(window.location.href);
  url.search = params.toString();
  history.replaceState(history.state, "", url);
}
