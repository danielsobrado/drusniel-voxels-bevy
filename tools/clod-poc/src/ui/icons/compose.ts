import { BACKGROUNDS, PALETTES } from "./palettes";
import { FX } from "./fx";
import { PRIMITIVES } from "./primitives";
import { hashStr, mulberry32, rad, rrPath, withAlpha } from "./drawing";
import type { IconRecipe } from "./types";

const SPECK_COUNT = 40;

export function compose(recipe: IconRecipe, seedKey: string, size: number): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.scale(size / 100, size / 100);
  ctx.save();
  rrPath(ctx, 0.5, 0.5, 99, 99, 12);
  ctx.clip();

  const bgc = BACKGROUNDS[recipe.bg];
  ctx.fillStyle = rad(ctx, 35, 30, 85, [[0, bgc[0]], [0.55, bgc[1]], [1, bgc[2]]]);
  ctx.fillRect(0, 0, 100, 100);

  const vg = ctx.createRadialGradient(50, 50, 55, 50, 50, 85);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, 100, 100);

  const rnd = mulberry32(hashStr(seedKey));
  for (let i = 0; i < SPECK_COUNT; i++) {
    ctx.fillStyle = i % 2 ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.06)";
    ctx.fillRect(2 + rnd() * 96, 2 + rnd() * 96, 1.4, 1.4);
  }

  ctx.translate(50, 50);
  const pal = PALETTES[recipe.pal];
  const fx = recipe.fx ?? [];
  if (fx.includes("glow")) FX.glow(ctx, pal);
  for (const pl of recipe.prims) {
    ctx.save();
    ctx.translate(pl.x ?? 0, pl.y ?? 0);
    if (pl.rot) ctx.rotate(pl.rot);
    if (pl.s) ctx.scale(pl.s, pl.s);
    if (pl.alpha) ctx.globalAlpha = pl.alpha;
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 3;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 2;
    PRIMITIVES[pl.p](ctx, PALETTES[pl.pal ?? recipe.pal]);
    ctx.restore();
  }
  for (const f of fx) {
    if (f !== "glow") FX[f](ctx, pal);
  }
  ctx.restore();

  ctx.lineWidth = 2;
  ctx.strokeStyle = "#000000";
  rrPath(ctx, 1, 1, 98, 98, 11);
  ctx.stroke();

  const edge = ctx.createLinearGradient(0, 0, 100, 100);
  edge.addColorStop(0, "rgba(255,255,255,0.28)");
  edge.addColorStop(0.5, "rgba(255,255,255,0.05)");
  edge.addColorStop(0.55, "rgba(0,0,0,0.1)");
  edge.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = edge;
  rrPath(ctx, 2.4, 2.4, 95.2, 95.2, 10);
  ctx.stroke();

  ctx.lineWidth = 1;
  ctx.strokeStyle = withAlpha(bgc[0], 0.22);
  rrPath(ctx, 3.6, 3.6, 92.8, 92.8, 9);
  ctx.stroke();
  return canvas;
}

export function headlessIconData(seedKey: string): string {
  const bytes = new TextEncoder().encode(`clod-icon:${seedKey}`);
  let out = "";
  for (const byte of bytes) out += String.fromCharCode(byte);
  return `data:image/png;base64,${globalThis.btoa(out)}`;
}
