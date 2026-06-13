export type MeterSeverity = "neutral" | "ok" | "warn" | "bad";

export interface MeterRowSnapshot {
  label: string;
  value: string;
  fraction?: number;
  severity?: MeterSeverity;
}

export interface MeterRow {
  element: HTMLElement;
  update(snapshot: MeterRowSnapshot): void;
}

export function createMeterRow(snapshot: MeterRowSnapshot): MeterRow {
  const element = document.createElement("div");
  element.className = "clod-meter-row";
  element.innerHTML = `
    <div class="clod-meter-top">
      <span class="clod-meter-label"></span>
      <span class="clod-meter-value"></span>
    </div>
    <div class="clod-meter-track"><span class="clod-meter-fill"></span></div>
  `;
  const label = element.querySelector<HTMLElement>(".clod-meter-label")!;
  const value = element.querySelector<HTMLElement>(".clod-meter-value")!;
  const fill = element.querySelector<HTMLElement>(".clod-meter-fill")!;
  const track = element.querySelector<HTMLElement>(".clod-meter-track")!;

  const update = (next: MeterRowSnapshot) => {
    label.textContent = next.label;
    value.textContent = next.value;
    element.dataset.severity = next.severity ?? "neutral";
    if (next.fraction == null) {
      track.hidden = true;
      fill.style.width = "0%";
    } else {
      track.hidden = false;
      fill.style.width = `${Math.max(0, Math.min(1, next.fraction)) * 100}%`;
    }
  };

  update(snapshot);
  return { element, update };
}
