import { createMeterRow, type MeterRow } from "./meter_rows.js";

export interface ClodOverlaySnapshot {
  worldSize: number;
  renderedTriangles: number;
  nodesByLod: Record<number, number>;
  forcedSplits: number;
  bubbleForcedSplits: number;
  cutFrozen: boolean;
  errorThreshold: number;
  buildStatus?: string;
  digCostLine?: string;
  polishLine?: string;
}

export interface ClodOverlay {
  update(snapshot: ClodOverlaySnapshot): void;
}

let activeOverlay: ClodOverlay | null = null;

const formatCount = (value: number) => Math.round(value).toLocaleString();

function lodText(nodesByLod: Record<number, number>): string {
  const parts = Object.entries(nodesByLod)
    .map(([level, count]) => [Number(level), count] as const)
    .sort(([a], [b]) => a - b)
    .map(([level, count]) => `L${level}:${count}`);
  return parts.length > 0 ? parts.join("  ") : "none";
}

function setText(root: HTMLElement, selector: string, text: string): void {
  root.querySelector<HTMLElement>(selector)!.textContent = text;
}

export function createClodOverlay(root: HTMLElement): ClodOverlay {
  root.innerHTML = `
    <section class="clod-overlay-panel" aria-live="polite">
      <header>
        <span class="clod-overlay-kicker">CLOD Runtime</span>
        <strong class="clod-overlay-world">world --</strong>
      </header>
      <div class="clod-overlay-meters"></div>
      <div class="clod-overlay-flags">
        <span data-overlay-freeze>live cut</span>
        <span data-overlay-status>preparing</span>
      </div>
      <p class="clod-overlay-dig"></p>
      <p class="clod-overlay-polish"></p>
    </section>
  `;
  const meterRoot = root.querySelector<HTMLElement>(".clod-overlay-meters")!;
  const meters: MeterRow[] = [
    createMeterRow({ label: "Triangles", value: "0", fraction: 0, severity: "neutral" }),
    createMeterRow({ label: "LOD cut", value: "none", severity: "neutral" }),
    createMeterRow({ label: "2:1 splits", value: "0", fraction: 0, severity: "ok" }),
    createMeterRow({ label: "Bubble splits", value: "0", fraction: 0, severity: "ok" }),
    createMeterRow({ label: "Error threshold", value: "0.00 px", fraction: 0, severity: "neutral" }),
  ];
  for (const meter of meters) meterRoot.appendChild(meter.element);

  const overlay: ClodOverlay = {
    update(snapshot) {
      setText(root, ".clod-overlay-world", `${snapshot.worldSize}x${snapshot.worldSize} pages`);
      meters[0].update({
        label: "Triangles",
        value: formatCount(snapshot.renderedTriangles),
        fraction: Math.min(1, snapshot.renderedTriangles / 250_000),
        severity: snapshot.renderedTriangles > 200_000 ? "warn" : "ok",
      });
      meters[1].update({ label: "LOD cut", value: lodText(snapshot.nodesByLod), severity: "neutral" });
      meters[2].update({
        label: "2:1 splits",
        value: formatCount(snapshot.forcedSplits),
        fraction: Math.min(1, snapshot.forcedSplits / 64),
        severity: snapshot.forcedSplits > 64 ? "warn" : "ok",
      });
      meters[3].update({
        label: "Bubble splits",
        value: formatCount(snapshot.bubbleForcedSplits),
        fraction: Math.min(1, snapshot.bubbleForcedSplits / 64),
        severity: snapshot.bubbleForcedSplits > 64 ? "warn" : "ok",
      });
      meters[4].update({
        label: "Error threshold",
        value: `${snapshot.errorThreshold.toFixed(2)} px`,
        fraction: Math.min(1, snapshot.errorThreshold / 6),
        severity: snapshot.errorThreshold < 0.8 ? "warn" : "neutral",
      });
      const freeze = root.querySelector<HTMLElement>("[data-overlay-freeze]")!;
      freeze.textContent = snapshot.cutFrozen ? "cut frozen" : "live cut";
      freeze.dataset.severity = snapshot.cutFrozen ? "warn" : "ok";
      setText(root, "[data-overlay-status]", snapshot.buildStatus ?? "ready");
      const dig = root.querySelector<HTMLElement>(".clod-overlay-dig")!;
      dig.hidden = !snapshot.digCostLine;
      dig.textContent = snapshot.digCostLine ? `Last edit: ${snapshot.digCostLine}` : "";
      const polish = root.querySelector<HTMLElement>(".clod-overlay-polish")!;
      polish.hidden = !snapshot.polishLine;
      polish.textContent = snapshot.polishLine ?? "";
    },
  };
  activeOverlay = overlay;
  return overlay;
}

export function updateClodOverlay(snapshot: ClodOverlaySnapshot): void {
  activeOverlay?.update(snapshot);
}
