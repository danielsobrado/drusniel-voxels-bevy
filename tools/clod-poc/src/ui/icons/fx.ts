import { rad, withAlpha } from "./drawing";
import { PRIMITIVES } from "./primitives";
import type { Ctx, FxName, IconPalette } from "./types";

type FxPainter = (ctx: Ctx, pal: IconPalette) => void;

export const FX = {
  glow(ctx, pal) {
    ctx.fillStyle = rad(ctx, 0, 0, 32, [[0, withAlpha(pal.glow, 0.55)], [1, withAlpha(pal.glow, 0)]]);
    ctx.fillRect(-50, -50, 100, 100);
  },
  sparkle(ctx, pal) {
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = pal.light;
    for (const [x, y, s] of [[-18, -15, 5.5], [16, -20, 4.5], [20, 13, 3.5]] as const) {
      ctx.beginPath();
      ctx.moveTo(x, y - s);
      ctx.lineTo(x + s * 0.38, y - s * 0.38);
      ctx.lineTo(x + s, y);
      ctx.lineTo(x + s * 0.38, y + s * 0.38);
      ctx.lineTo(x, y + s);
      ctx.lineTo(x - s * 0.38, y + s * 0.38);
      ctx.lineTo(x - s, y);
      ctx.lineTo(x - s * 0.38, y - s * 0.38);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  },
  crack(ctx, pal) {
    ctx.strokeStyle = withAlpha(pal.dark, 0.9);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(-1, 1);
    ctx.lineTo(-8, 9);
    ctx.lineTo(-5, 17);
    ctx.lineTo(-13, 26);
    ctx.moveTo(3, -2);
    ctx.lineTo(10, -10);
    ctx.lineTo(7, -18);
    ctx.lineTo(15, -27);
    ctx.stroke();
  },
  motion(ctx, pal) {
    ctx.strokeStyle = withAlpha(pal.light, 0.42);
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (const o of [-12, 0, 12]) {
      ctx.moveTo(-27 + o * 0.7, -25 - o * 0.7);
      ctx.lineTo(22 + o * 0.7, 22 - o * 0.7);
    }
    ctx.stroke();
  },
} satisfies Record<FxName, FxPainter>;

export function paintTinySpark(ctx: Ctx, pal: IconPalette, x: number, y: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(0.35, 0.35);
  PRIMITIVES.sigil(ctx, pal);
  ctx.restore();
}
