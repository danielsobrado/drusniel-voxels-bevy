import type GUI from "lil-gui";

function setQueryValue(key: string, value: string | null): void {
  const next = new URLSearchParams(location.search);
  if (value === null) next.delete(key);
  else next.set(key, value);
  history.replaceState(null, "", `${location.pathname}${next.toString() ? `?${next.toString()}` : ""}${location.hash}`);
}

function readRuntimeOptions(): any | null {
  return (window as unknown as Record<string, any>).__drusnielSunLightOptions ?? null;
}

function readRuntimeStats(): any | null {
  const reader = (window as unknown as Record<string, any>).__drusnielSunLightStats;
  return typeof reader === "function" ? reader() : null;
}

export function createSunLightGui(gui: GUI): void {
  const options = readRuntimeOptions();
  const folder = gui.addFolder("sun light cache");
  const state = {
    active: options?.active ?? new URLSearchParams(location.search).get("sunLightCache") !== "0",
    stats: new URLSearchParams(location.search).get("sunLightStats") === "1",
    debug: options?.debugView?.active ?? new URLSearchParams(location.search).get("sunLightDebug") === "1",
    maxTilesPerFrame: options?.build?.maxTilesPerFrame ?? 2,
    maxBuildMsPerFrame: options?.build?.maxBuildMsPerFrame ?? 1,
    tileResolution: options?.tile?.resolution ?? 32,
    cameraTileRadius: options?.debugView?.cameraTileRadius ?? 1,
    entries: 0,
    pending: 0,
    hits: 0,
    misses: 0,
    builtThisFrame: 0,
    buildMs: 0,
    refresh: () => {
      const refresh = (window as unknown as Record<string, any>).__drusnielSunLightRefresh;
      if (typeof refresh === "function") refresh();
    },
  };

  folder.add(state, "active").name("enabled").onChange((enabled: boolean) => {
    if (options) options.active = enabled;
    setQueryValue("sunLightCache", enabled ? null : "0");
  });
  folder.add(state, "stats").name("stats counters").onChange((enabled: boolean) => {
    if (options) options.diagnostics = enabled;
    setQueryValue("sunLightStats", enabled ? "1" : null);
  });
  folder.add(state, "debug").name("debug overlay").onChange((enabled: boolean) => {
    if (options?.debugView) options.debugView.active = enabled;
    setQueryValue("sunLightDebug", enabled ? "1" : null);
  });
  folder.add(state, "maxTilesPerFrame", 1, 16, 1).name("tiles / frame").onChange((value: number) => {
    if (options?.build) options.build.maxTilesPerFrame = value;
  });
  folder.add(state, "maxBuildMsPerFrame", 0.1, 8, 0.1).name("build ms budget").onChange((value: number) => {
    if (options?.build) options.build.maxBuildMsPerFrame = value;
  });
  folder.add(state, "tileResolution", 4, 64, 1).name("tile resolution").onChange((value: number) => {
    if (options?.tile) options.tile.resolution = value;
  });
  folder.add(state, "cameraTileRadius", 0, 4, 1).name("camera tile radius").onChange((value: number) => {
    if (options?.debugView) options.debugView.cameraTileRadius = value;
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
  setInterval(() => {
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
