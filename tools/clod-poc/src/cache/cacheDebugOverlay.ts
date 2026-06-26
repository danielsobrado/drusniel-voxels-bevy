import {
  averageDecodeMs,
  averageEncodeMs,
  hitRate,
} from "./cacheMetrics.js";
import { getClodCacheContext } from "./clodCacheContext.js";
import { setCacheSessionDisabled } from "./cacheConfig.js";
import type { ClodCacheMetrics } from "./cacheMetrics.js";

export interface CacheDebugOverlay {
  element: HTMLElement;
  update(): void;
  destroy(): void;
}

export function createCacheDebugOverlay(): CacheDebugOverlay | null {
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
    max-width: 280px; pointer-events: auto;
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
    const m: ClodCacheMetrics = active.service.getMetrics();
    pre.textContent = formatMetrics(active.config.enabled, m);
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
    await active.service.clearPersistent();
    update();
  };

  root.querySelector<HTMLButtonElement>("[data-cache-disable-session]")!.onclick = () => {
    setCacheSessionDisabled(true);
    update();
  };

  root.querySelector<HTMLButtonElement>("[data-cache-dump-metrics]")!.onclick = () => {
    const active = getClodCacheContext();
    if (!active) return;
    console.log("[clod-cache-metrics]", active.service.getMetrics());
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

function formatMetrics(enabled: boolean, m: ClodCacheMetrics): string {
  const hr = (hitRate(m) * 100).toFixed(1);
  return [
    `enabled: ${enabled && m.enabled}`,
    `memory: ${m.memoryEntries}`,
    `persistent: ${m.persistentEntries}`,
    `pending r/w: ${m.pendingReads}/${m.pendingWrites}`,
    `hits/miss: ${m.hits}/${m.misses} (${hr}%)`,
    `evictions: ${m.evictions}`,
    `bytes r/w: ${m.bytesRead}/${m.bytesWritten}`,
    `nodes cached: ${m.nodesLoadedFromCache}`,
    `build saved ms: ${m.buildMsSaved.toFixed(1)}`,
    `decode avg: ${averageDecodeMs(m).toFixed(2)} ms`,
    `encode avg: ${averageEncodeMs(m).toFixed(2)} ms`,
    `last miss: ${m.lastMissReason ?? "-"}`,
    `last error: ${m.lastError ?? "-"}`,
  ].join("\n");
}
