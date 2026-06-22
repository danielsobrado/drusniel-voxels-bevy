import type { PerspectiveCamera } from "three";
import type { EngineStats } from "../core/hooks.js";
import type { ClodParams } from "../core/params.js";

export class Hud {
  private readonly panel: HTMLDivElement;
  private readonly chip: HTMLDivElement;
  private visible: boolean;
  private elapsed = 0;

  constructor(
    private readonly stats: EngineStats,
    private readonly params: ClodParams,
    private readonly camera: PerspectiveCamera,
  ) {
    this.visible = params.hud;
    this.panel = document.createElement("div");
    this.panel.style.cssText = [
      "position:fixed",
      "top:10px",
      "left:10px",
      "z-index:1000",
      "color:#dfece7",
      "background:rgba(8,12,13,0.66)",
      "padding:10px 12px",
      "font:11px/1.45 ui-monospace,Menlo,Consolas,monospace",
      "white-space:pre",
      "pointer-events:none",
      "border-radius:4px",
      "max-height:90vh",
      "overflow:hidden",
    ].join(";");
    this.chip = document.createElement("div");
    this.chip.style.cssText = [
      "position:fixed",
      "top:10px",
      "left:10px",
      "z-index:1000",
      "color:#dfece7",
      "background:rgba(8,12,13,0.56)",
      "padding:3px 8px",
      "font:12px/1.2 ui-monospace,Menlo,Consolas,monospace",
      "pointer-events:none",
      "border-radius:4px",
    ].join(";");
    document.body.append(this.panel, this.chip);
    this.applyVisibility();
    window.addEventListener("keydown", (event) => {
      if (event.code !== "F3") return;
      event.preventDefault();
      this.visible = !this.visible;
      this.applyVisibility();
    });
  }

  update(dt: number): void {
    this.elapsed += dt;
    if (this.elapsed < 0.25) return;
    this.elapsed = 0;
    if (this.visible) this.renderPanel();
    else this.chip.textContent = `${this.stats.fps.toFixed(0)} fps`;
  }

  private applyVisibility(): void {
    this.panel.style.display = this.visible ? "block" : "none";
    this.chip.style.display = this.visible ? "none" : "block";
  }

  private renderPanel(): void {
    const fmt = (n: number): string => n.toLocaleString("en-US");
    const c = this.camera.position;
    const lines = [
      `Drusniel CLOD  seed=${this.params.seed} scene=${this.params.scene}`,
      `${this.stats.fps.toFixed(0)} fps  ${this.stats.frameMs.toFixed(2)} ms (p95 ${this.stats.frameMsP95.toFixed(2)})`,
      `draws ${fmt(this.stats.drawCalls)}  tris ${fmt(this.stats.triangles)}`,
      `gpu render ${this.stats.gpuPasses["render"]?.toFixed(2) ?? "unsupported"} ms  compute ${this.stats.gpuPasses["compute"]?.toFixed(2) ?? "unsupported"} ms`,
      `cam ${c.x.toFixed(1)}, ${c.y.toFixed(1)}, ${c.z.toFixed(1)}`,
    ];
    const passes = Object.entries(this.stats.gpuPasses)
      .filter(([, value]) => value > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    if (passes.length > 0) {
      lines.push("--");
      for (const [key, value] of passes) lines.push(`${value.toFixed(2).padStart(6)} ${key}`);
    }
    const counterKeys = Object.keys(this.stats.counters).sort();
    if (counterKeys.length > 0) {
      lines.push("--");
      for (const key of counterKeys) lines.push(`${key}: ${fmt(this.stats.counters[key] ?? 0)}`);
    }
    this.panel.textContent = lines.join("\n");
  }
}
