import type GUI from "lil-gui";
import { loadBundledSunLightOptions } from "../../terrain/sun_visibility/sun_light_config_loader.js";

interface SunLightGuiOptions {
  active: boolean;
  diagnostics: boolean;
  build: {
    maxTilesPerFrame: number;
    maxBuildMsPerFrame: number;
  };
  tile: {
    resolution: number;
  };
  debugView: {
    active?: boolean;
    cameraTileRadius: number;
  };
}

interface SunLightGuiStats {
  entries: number;
  pendingTiles: number;
  hits: number;
  misses: number;
  tilesBuiltThisFrame: number;
  buildMsLastFrame: number;
}

interface SunLightWindowHooks {
  __drusnielSunLightOptions?: SunLightGuiOptions;
  __drusnielSunLightStats?: () => SunLightGuiStats;
  __drusnielSunLightRefresh?: () => void;
}

function queryFlag(searchParams: URLSearchParams, key: string, fallback: boolean): boolean {
  return searchParams.has(key) ? searchParams.get(key) !== "0" : fallback;
}

function setQueryValue(key: string, value: string | null): void {
  const next = new URLSearchParams(location.search);
  if (value === null) next.delete(key);
  else next.set(key, value);
  history.replaceState(null, "", `${location.pathname}${next.toString() ? `?${next.toString()}` : ""}${location.hash}`);
}

function hooks(): SunLightWindowHooks {
  return window as unknown as SunLightWindowHooks;
}

function readRuntimeOptions(): SunLightGuiOptions | null {
  return hooks().__drusnielSunLightOptions ?? null;
}

function readRuntimeStats(): SunLightGuiStats | null {
  const reader = hooks().__drusnielSunLightStats;
  return typeof reader === "function" ? reader() : null;
}

function clearRuntimeCache(): void {
  hooks().__drusnielSunLightRefresh?.();
}

export function createSunLightGui(gui: GUI): void {
  const initialOptions = readRuntimeOptions() ?? loadBundledSunLightOptions();
  const searchParams = new URLSearchParams(location.search);
  const folder = gui.addFolder("sun light cache");
  const state = {
    active: queryFlag(searchParams, "sunLightCache", initialOptions.active),
    stats: queryFlag(searchParams, "sunLightStats", initialOptions.diagnostics),
    debug: queryFlag(searchParams, "sunLightDebug", initialOptions.debugView.active === true),
    maxTilesPerFrame: initialOptions.build.maxTilesPerFrame,
    maxBuildMsPerFrame: initialOptions.build.maxBuildMsPerFrame,
    tileResolution: initialOptions.tile.resolution,
    cameraTileRadius: initialOptions.debugView.cameraTileRadius,
    entries: 0,
    pending: 0,
    hits: 0,
    misses: 0,
    builtThisFrame: 0,
    buildMs: 0,
    refresh: clearRuntimeCache,
  };

  folder.add(state, "active").name("enabled").onChange((enabled: boolean) => {
    const options = readRuntimeOptions();
    if (options) options.active = enabled;
    setQueryValue("sunLightCache", enabled ? "1" : "0");
  });
  folder.add(state, "stats").name("stats counters").onChange((enabled: boolean) => {
    const options = readRuntimeOptions();
    if (options) options.diagnostics = enabled;
    setQueryValue("sunLightStats", enabled ? "1" : "0");
  });
  folder.add(state, "debug").name("debug overlay").onChange((enabled: boolean) => {
    const options = readRuntimeOptions();
    if (options) options.debugView.active = enabled;
    setQueryValue("sunLightDebug", enabled ? "1" : "0");
  });
  folder.add(state, "maxTilesPerFrame", 1, 16, 1).name("tiles / frame").onChange((value: number) => {
    const options = readRuntimeOptions();
    if (options) options.build.maxTilesPerFrame = value;
  });
  folder.add(state, "maxBuildMsPerFrame", 0.1, 8, 0.1).name("build ms budget").onChange((value: number) => {
    const options = readRuntimeOptions();
    if (options) options.build.maxBuildMsPerFrame = value;
  });
  folder.add(state, "tileResolution", 4, 64, 1).name("tile resolution").onChange((value: number) => {
    const options = readRuntimeOptions();
    if (options) options.tile.resolution = value;
    clearRuntimeCache();
  });
  folder.add(state, "cameraTileRadius", 0, 4, 1).name("camera tile radius").onChange((value: number) => {
    const options = readRuntimeOptions();
    if (options) options.debugView.cameraTileRadius = value;
  });
  folder.add(state, "refresh").name("clear cache");

  const statsFolder = folder.addFolder("stats");
  const controllers = [
    statsFolder.add(state, "entries").name("entries").listen(),
    statsFolder.add(state, "pending").name("pending").listen(),
    statsFolder.add(state, "hits").name("hits").listen(),
    statsFolder.add(state, "misses").name("misses").listen(),
    statsFolder.add(state, "builtThisFrame").name("built/frame").listen(),
    statsFolder.add(state, "buildMs").name("build ms").listen(),
  ];
  window.setInterval(() => {
    const stats = readRuntimeStats();
    if (!stats) return;
    state.entries = stats.entries;
    state.pending = stats.pendingTiles;
    state.hits = stats.hits;
    state.misses = stats.misses;
    state.builtThisFrame = stats.tilesBuiltThisFrame;
    state.buildMs = Number(stats.buildMsLastFrame.toFixed(3));
    controllers.forEach((controller) => controller.updateDisplay());
  }, 250);
}
