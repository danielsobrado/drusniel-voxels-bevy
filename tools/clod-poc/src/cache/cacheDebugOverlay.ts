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
import { attachDebugPanelChrome } from "../ui/debug_panel_chrome.js";

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

  const host = document.createElement("div");
  document.body.appendChild(host);

  const content = document.createElement("div");
  content.innerHTML = `
    <pre data-cache-stats></pre>
    <div class="clod-cache-overlay-actions">
      <button type="button" data-cache-clear-memory>Clear memory</button>
      <button type="button" data-cache-clear-persistent>Clear persistent</button>
      <button type="button" data-cache-disable-session>Disable session</button>
      <button type="button" data-cache-dump-metrics>Dump metrics</button>
    </div>
  `;
  host.appendChild(content);

  const chrome = attachDebugPanelChrome(host, {
    panelId: "clod-cache",
    title: "CLOD Cache",
    floating: true,
    defaultPosition: { left: 12, top: 120 },
    onClose: () => host.remove(),
  });

  chrome.body.style.padding = "8px 10px";

  const actions = chrome.body.querySelector<HTMLElement>(".clod-cache-overlay-actions")!;
  actions.style.display = "flex";
  actions.style.flexWrap = "wrap";
  actions.style.gap = "4px";
  actions.style.marginTop = "6px";
  for (const btn of Array.from(actions.querySelectorAll("button"))) {
    (btn as HTMLButtonElement).style.fontSize = "10px";
  }

  requestAnimationFrame(() => {
    const rect = chrome.root.getBoundingClientRect();
    if (rect.height > 0 && rect.top < 80) {
      chrome.setPosition(12, Math.max(12, window.innerHeight - rect.height - 200));
    }
  });

  const update = () => {
    const active = getClodCacheContext();
    const pre = chrome.body.querySelector<HTMLElement>("[data-cache-stats]")!;
    if (!active) {
      pre.textContent = "cache: not initialized";
      return;
    }
    pre.textContent = formatCombinedMetrics(active.config.enabled, active.service.getMetrics());
  };

  chrome.body.querySelector<HTMLButtonElement>("[data-cache-clear-memory]")!.onclick = () => {
    const active = getClodCacheContext();
    if (!active) return;
    active.service.clearMemory();
    update();
  };

  chrome.body.querySelector<HTMLButtonElement>("[data-cache-clear-persistent]")!.onclick = async () => {
    const active = getClodCacheContext();
    if (!active) return;
    await active.service.clear();
    if (deps.clearWorkerCache) {
      await deps.clearWorkerCache();
    }
    update();
  };

  chrome.body.querySelector<HTMLButtonElement>("[data-cache-disable-session]")!.onclick = () => {
    setCacheSessionDisabled(true);
    update();
  };

  chrome.body.querySelector<HTMLButtonElement>("[data-cache-dump-metrics]")!.onclick = () => {
    const active = getClodCacheContext();
    if (!active) return;
    console.log("[clod-cache-metrics]", {
      main: active.service.getMetrics(),
      workerBuild: getWorkerCacheBuildStats(),
      workerService: getWorkerCacheServiceMetrics(),
    });
  };

  update();

  return {
    element: chrome.root,
    update,
    destroy() {
      host.remove();
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
