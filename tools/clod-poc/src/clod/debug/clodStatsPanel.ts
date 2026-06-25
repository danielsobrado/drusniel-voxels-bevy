import type { ClodRuntimeStats } from "../runtime/clodRuntimeTypes.js";
import { formatStatsText } from "../runtime/clodRuntimeStats.js";

export class ClodStatsPanel {
  private readonly container: HTMLElement;
  private visible = true;
  private pre: HTMLPreElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.pre = document.createElement("pre");
    this.pre.className = "clod-stats-panel";
    this.pre.style.cssText = `
      position: fixed;
      bottom: 8px;
      left: 8px;
      background: rgba(0,0,0,0.75);
      color: #9fef9f;
      font: 11px/1.4 monospace;
      padding: 6px 10px;
      border-radius: 4px;
      pointer-events: none;
      z-index: 100;
      margin: 0;
    `;
    this.container.appendChild(this.pre);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.pre.hidden = !visible;
  }

  update(stats: ClodRuntimeStats): void {
    if (!this.visible) return;
    this.pre.textContent = formatStatsText(stats).join("\n");
  }

  dispose(): void {
    this.pre.remove();
  }
}
