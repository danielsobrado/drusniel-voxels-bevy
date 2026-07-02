// The WebGPU preview short-circuits main(), so the normal app chrome would otherwise sit frozen.
export function hideWebGpuPreviewAppChrome(): void {
  for (const id of [
    "clod-left-stack",
    "project-toolbar",
    "player-mode-bar",
    "crosshair",
    "terraform-menu",
    "build-progress",
  ]) {
    document.getElementById(id)?.style.setProperty("display", "none");
  }
}

export function makeWebGpuPreviewOverlay(): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText =
    "position:fixed;top:8px;left:8px;z-index:10;font:12px/1.4 monospace;" +
    "color:#cde;background:rgba(0,0,0,0.55);padding:8px 10px;border-radius:6px;white-space:pre";
  document.body.appendChild(el);
  return el;
}
