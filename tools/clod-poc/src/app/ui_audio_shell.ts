import { emitAudio } from "../audio/index.js";

export function bindUiAudioShell(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (!target) return;
    const isInteractive =
      target.tagName === "BUTTON" ||
      target.tagName === "SELECT" ||
      target.tagName === "A" ||
      (target.tagName === "INPUT" && (target as HTMLInputElement).type === "checkbox") ||
      target.classList.contains("tf-swatch") ||
      target.classList.contains("texture-preview") ||
      window.getComputedStyle(target).cursor === "pointer";
    if (isInteractive) {
      if (target.tagName === "INPUT" && (target as HTMLInputElement).type === "checkbox") {
        emitAudio((target as HTMLInputElement).checked ? "ui.toggle.on" : "ui.toggle.off");
      } else {
        emitAudio("ui.click");
      }
    }
  }, { capture: true, passive: true });

  let lastHoveredElement: HTMLElement | null = null;
  window.addEventListener("pointerover", (event) => {
    const target = event.target as HTMLElement;
    if (!target || target === lastHoveredElement) return;
    lastHoveredElement = target;
    const isInteractive =
      target.tagName === "BUTTON" ||
      target.tagName === "SELECT" ||
      target.tagName === "A" ||
      (target.tagName === "INPUT" && (target as HTMLInputElement).type === "checkbox") ||
      target.classList.contains("tf-swatch") ||
      target.classList.contains("texture-preview");
    if (isInteractive) {
      emitAudio("ui.hover");
    }
  }, { capture: true, passive: true });
  window.addEventListener("pointerout", () => {
    lastHoveredElement = null;
  }, { capture: true, passive: true });
}
