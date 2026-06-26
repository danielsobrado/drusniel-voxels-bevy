import type { ClodRuntimeStats } from "../runtime/clodRuntimeTypes.js";
import { formatStatsText } from "../runtime/clodRuntimeStats.js";
import { attachDebugPanelChrome } from "../../ui/debug_panel_chrome.js";

export class ClodStatsPanel {
  private readonly chromeRoot: HTMLElement;
  private readonly pre: HTMLPreElement;
  private visible = true;

  constructor(container: HTMLElement) {
    const host = document.createElement("div");
    container.appendChild(host);

    this.pre = document.createElement("pre");
    this.pre.className = "clod-stats-panel";
    this.pre.style.cssText = `
      color: #9fef9f;
      font: 11px/1.4 monospace;
      margin: 0;
      white-space: pre-wrap;
    `;
    host.appendChild(this.pre);

    const chrome = attachDebugPanelChrome(host, {
      panelId: "clod-stats",
      title: "CLOD Stats",
      floating: true,
      defaultPosition: { left: 8, top: Math.max(12, window.innerHeight - 220) },
      onClose: () => host.remove(),
    });
    chrome.body.style.padding = "6px 10px";
    this.chromeRoot = chrome.root;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.chromeRoot.hidden = !visible;
  }

  update(stats: ClodRuntimeStats): void {
    if (!this.visible) return;
    this.pre.textContent = formatStatsText(stats).join("\n");
  }

  dispose(): void {
    this.chromeRoot.parentElement?.remove();
  }
}
