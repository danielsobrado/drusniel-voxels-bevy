import {
  averageDecodeMs,
  averageEncodeMs,
  type ClodCacheMetrics,
} from "./cacheMetrics.js";
import { getClodCacheContext } from "./clodCacheContext.js";
import { setCacheSessionDisabled } from "./cacheConfig.js";
import {
  getWorkerCacheBuildStats,
  getWorkerCacheServiceMetrics,
} from "./cacheMetricsBridge.js";

export interface CacheDebugOverlay {
  element: HTMLElement;
  update(): void;
  destroy(): void;
}

export interface CacheDebugOverlayDeps {
  clearWorkerCache?: () => Promise<void>;
}

export function createCacheDebugOverlay(deps: CacheDebugOverlayDeps = {}): CacheDebugOverlay | null {
  const ctx = getClodCacheContext();
  if (!ctx?.config.debug.expose_overlay_stats) return null;

  const root = document.createElement("section");
  root.className = "clod-cache-overlay";
  root.innerHTML = `
    <header><strong>CLOD Cache</strong></header>
    <pre data-cache-stats></pre>
    <div class="clod-cache-overlay-actions">
      <button type="button" data-cache-clear-memory>Clear memory</button>
      <button type="button" data-cache-clear-persistent>Clear persistent</button>
      <button type="button" data-cache-disable-session>Disable session</button>
      <button type="button" data-cache-dump-metrics>Dump metrics</button>
    </div>
  `;
  root.style.cssText = `
    position: fixed; right: 12px; top: 120px; z-index: 9000;
    background: rgba(10,14,20,0.88); color: #c8e6ff; font: 11px/1.35 monospace;
    padding: 8px 10px; border: 1px solid rgba(120,180,255,0.35); border-radius: 6px;
    max-width: 320px; pointer-events: auto;
  `;
  const actions = root.querySelector<HTMLElement>(".clod-cache-overlay-actions")!;
  actions.style.display = "flex";
  actions.style.flexWrap = "wrap";
  actions.style.gap = "4px";
  for (const btn of Array.from(actions.querySelectorAll("button"))) {
    (btn as HTMLButtonElement).style.fontSize = "10px";
  }

  const update = () => {
    const active = getClodCacheContext();
    const pre = root.querySelector<HTMLElement>("[data-cache-stats]")!;
    if (!active) {
      pre.textContent = "cache: not initialized";
      return;
    }
    pre.textContent = formatCombinedMetrics(active.config.enabled, active.service.getMetrics());
  };

  root.querySelector<HTMLButtonElement>("[data-cache-clear-memory]")!.onclick = () => {
    const active = getClodCacheContext();
    if (!active) return;
    active.service.clearMemory();
    update();
  };

  root.querySelector<HTMLButtonElement>("[data-cache-clear-persistent]")!.onclick = async () => {
    const active = getClodCacheContext();
    if (!active) return;
    active.service.clearMemory();
    if (deps.clearWorkerCache) {
      await deps.clearWorkerCache();
    } else {
      await active.service.clearPersistent();
    }
    update();
  };

  root.querySelector<HTMLButtonElement>("[data-cache-disable-session]")!.onclick = () => {
    setCacheSessionDisabled(true);
    update();
  };

  root.querySelector<HTMLButtonElement>("[data-cache-dump-metrics]")!.onclick = () => {
    const active = getClodCacheContext();
    if (!active) return;
    console.log("[clod-cache-metrics]", {
      main: active.service.getMetrics(),
      workerBuild: getWorkerCacheBuildStats(),
      workerService: getWorkerCacheServiceMetrics(),
    });
  };

  document.body.appendChild(root);
  update();

  return {
    element: root,
    update,
    destroy() {
      root.remove();
    },
  };
}

function formatCombinedMetrics(enabled: boolean, main: ClodCacheMetrics): string {
  const worker = getWorkerCacheServiceMetrics();
  const workerBuild = getWorkerCacheBuildStats();
  const combinedHits = main.hits + (worker?.hits ?? 0);
  const combinedMisses = main.misses + (worker?.misses ?? 0);
  const combinedHitRate = combinedHits + combinedMisses > 0
    ? ((combinedHits / (combinedHits + combinedMisses)) * 100).toFixed(1)
    : "0.0";

  return [
    `enabled: ${enabled}`,
    "--- main (terrain summary) ---",
    `mem/persist: ${main.memoryEntries}/${main.persistentEntries}`,
    `hits/miss: ${main.hits}/${main.misses}`,
    `bytes r/w: ${main.bytesRead}/${main.bytesWritten}`,
    "--- worker (page nodes) ---",
    `nodes cached: ${workerBuild?.nodesFromCache ?? 0}`,
    `hits/miss: ${workerBuild?.cacheHits ?? 0}/${workerBuild?.cacheMisses ?? 0}`,
    `build avoided: ${(workerBuild?.coldBuildMsAvoided ?? 0).toFixed(1)} ms`,
    `decode: ${(workerBuild?.cacheDecodeMs ?? 0).toFixed(1)} ms`,
    `net saved: ${(workerBuild?.netSavedMs ?? 0).toFixed(1)} ms`,
    `svc hits/miss: ${worker?.hits ?? 0}/${worker?.misses ?? 0}`,
    "--- combined ---",
    `hit rate: ${combinedHitRate}%`,
    `pending r/w: ${(main.pendingReads + (worker?.pendingReads ?? 0))}/${(main.pendingWrites + (worker?.pendingWrites ?? 0))}`,
    `decode avg: ${averageDecodeMs(main).toFixed(2)} ms`,
    `encode avg: ${averageEncodeMs(main).toFixed(2)} ms`,
    `last miss: ${main.lastMissReason ?? worker?.lastMissReason ?? "-"}`,
    `last error: ${main.lastError ?? worker?.lastError ?? "-"}`,
  ].join("\n");
}
