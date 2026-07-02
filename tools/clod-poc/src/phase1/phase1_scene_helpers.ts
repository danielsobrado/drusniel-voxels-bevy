import * as THREE from "three";
import type { ClodPageNode } from "../types.js";

export function hideNormalAppChrome(): void {
  for (const id of ["clod-left-stack", "project-toolbar", "player-mode-bar", "terraform-menu", "build-progress", "crosshair"]) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.setAttribute("hidden", "");
    el.style.display = "none";
  }
}

export function updateProgress(progress: number, message: string): void {
  if (!window.__drusnielClod) return;
  window.__drusnielClod.progress = progress;
  window.__drusnielClod.progressMsg = message;
}

export function failDetails(error: unknown): string[] {
  const details = [error instanceof Error ? error.message : String(error)];
  if (error instanceof Error && error.stack) details.push(error.stack);
  const msg = window.__drusnielClod?.progressMsg;
  if (msg) details.push(`progress: ${msg}`);
  return details;
}

export function allNodes(nodesByLevel: Map<number, ClodPageNode[]>): ClodPageNode[] {
  return [...nodesByLevel.values()].flat();
}

export function countLevel(rendered: readonly ClodPageNode[], level: number): number {
  return rendered.filter((n) => n.level === level).length;
}

export function countBuiltLevel(nodesByLevel: Map<number, ClodPageNode[]>, level: number): number {
  return nodesByLevel.get(level)?.length ?? 0;
}

export function disposeDebugGroup(group: THREE.Group): void {
  for (const child of [...group.children]) {
    const r = child as THREE.LineSegments | THREE.Points;
    r.geometry?.dispose();
    const mat = r.material;
    if (Array.isArray(mat)) mat.forEach((e) => e.dispose());
    else mat?.dispose();
    group.remove(child);
  }
}
