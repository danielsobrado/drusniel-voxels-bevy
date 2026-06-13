import { edge, lin, noShadow, rad, rrPath, TAU, withAlpha } from "./drawing";
import type { Ctx, IconPalette, PrimitiveName } from "./types";

type Painter = (ctx: Ctx, pal: IconPalette) => void;

function diamond(ctx: Ctx, r: number): void {
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(r, 0);
  ctx.lineTo(0, r);
  ctx.lineTo(-r, 0);
  ctx.closePath();
}

function arrow(ctx: Ctx, dir: "up" | "down", pal: IconPalette): void {
  const s = dir === "up" ? 1 : -1;
  ctx.fillStyle = lin(ctx, 0, -28 * s, 0, 28 * s, [[0, pal.light], [0.55, pal.base], [1, pal.dark]]);
  rrPath(ctx, -5, -5 * s, 10, 30 * s, 3);
  ctx.fill();
  edge(ctx, pal.accent, 1.4);
  ctx.beginPath();
  ctx.moveTo(0, -30 * s);
  ctx.lineTo(17, -8 * s);
  ctx.lineTo(6, -8 * s);
  ctx.lineTo(6, 2 * s);
  ctx.lineTo(-6, 2 * s);
  ctx.lineTo(-6, -8 * s);
  ctx.lineTo(-17, -8 * s);
  ctx.closePath();
  ctx.fill();
  edge(ctx, pal.accent, 1.5);
}

export const PRIMITIVES = {
  terrainTile(ctx, pal) {
    ctx.beginPath();
    ctx.moveTo(-24, -8);
    ctx.lineTo(0, -22);
    ctx.lineTo(24, -8);
    ctx.lineTo(0, 7);
    ctx.closePath();
    ctx.fillStyle = lin(ctx, -12, -21, 18, 0, [[0, pal.light], [0.6, pal.base], [1, pal.dark]]);
    ctx.fill();
    edge(ctx, pal.accent, 1.5);
    ctx.beginPath();
    ctx.moveTo(-24, -8);
    ctx.lineTo(0, 7);
    ctx.lineTo(0, 28);
    ctx.lineTo(-24, 12);
    ctx.closePath();
    ctx.fillStyle = withAlpha(pal.dark, 0.9);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(24, -8);
    ctx.lineTo(0, 7);
    ctx.lineTo(0, 28);
    ctx.lineTo(24, 12);
    ctx.closePath();
    ctx.fillStyle = withAlpha(pal.base, 0.8);
    ctx.fill();
    edge(ctx, pal.accent, 1.1);
  },
  grassTuft(ctx, pal) {
    ctx.fillStyle = pal.light;
    for (const x of [-13, -6, 1, 8, 15]) {
      ctx.beginPath();
      ctx.moveTo(x, 18);
      ctx.quadraticCurveTo(x - 5, -4, x + (x % 2 ? 5 : -5), -24);
      ctx.quadraticCurveTo(x + 4, -2, x + 4, 18);
      ctx.closePath();
      ctx.fill();
      edge(ctx, pal.dark, 0.8);
    }
  },
  stone(ctx, pal) {
    for (const [x, y, r] of [[-10, 3, 13], [5, -6, 17], [13, 11, 10]] as const) {
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.72, -0.25, 0, TAU);
      ctx.fillStyle = rad(ctx, x - 5, y - 5, r * 1.3, [[0, pal.light], [0.6, pal.base], [1, pal.dark]]);
      ctx.fill();
      edge(ctx, pal.accent, 1.2);
    }
  },
  waves(ctx, pal) {
    ctx.strokeStyle = pal.light;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    for (const y of [-14, 0, 14]) {
      ctx.beginPath();
      ctx.moveTo(-25, y);
      ctx.bezierCurveTo(-13, y - 10, -7, y + 10, 5, y);
      ctx.bezierCurveTo(15, y - 8, 20, y + 6, 27, y);
      ctx.stroke();
    }
  },
  page(ctx, pal) {
    ctx.beginPath();
    ctx.moveTo(-18, -26);
    ctx.lineTo(9, -26);
    ctx.lineTo(20, -15);
    ctx.lineTo(20, 26);
    ctx.lineTo(-18, 26);
    ctx.closePath();
    ctx.fillStyle = lin(ctx, -18, -26, 20, 26, [[0, pal.light], [0.65, pal.base], [1, pal.dark]]);
    ctx.fill();
    edge(ctx, pal.accent, 1.5);
    noShadow(ctx);
    ctx.strokeStyle = withAlpha(pal.accent, 0.65);
    ctx.lineWidth = 2;
    for (const y of [-8, 2, 12]) {
      ctx.beginPath();
      ctx.moveTo(-9, y);
      ctx.lineTo(11, y);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(9, -26);
    ctx.lineTo(9, -15);
    ctx.lineTo(20, -15);
    ctx.stroke();
  },
  slot(ctx, pal) {
    ctx.fillStyle = withAlpha(pal.dark, 0.5);
    rrPath(ctx, -24, -24, 48, 48, 8);
    ctx.fill();
    edge(ctx, withAlpha(pal.light, 0.8), 2.2);
    ctx.strokeStyle = withAlpha(pal.light, 0.35);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-12, 0);
    ctx.lineTo(12, 0);
    ctx.moveTo(0, -12);
    ctx.lineTo(0, 12);
    ctx.stroke();
  },
  shovel(ctx, pal) {
    ctx.rotate(0.7);
    ctx.fillStyle = lin(ctx, -3, -25, 3, 21, [[0, "#9b6a34"], [1, "#3a2110"]]);
    rrPath(ctx, -3, -28, 6, 48, 3);
    ctx.fill();
    edge(ctx, "#241307", 1);
    ctx.beginPath();
    ctx.moveTo(-12, 16);
    ctx.quadraticCurveTo(0, 34, 12, 16);
    ctx.lineTo(7, 1);
    ctx.lineTo(-7, 1);
    ctx.closePath();
    ctx.fillStyle = lin(ctx, -10, 2, 10, 28, [[0, pal.light], [0.55, pal.base], [1, pal.dark]]);
    ctx.fill();
    edge(ctx, pal.accent, 1.4);
  },
  arrowUp(ctx, pal) {
    arrow(ctx, "up", pal);
  },
  arrowDown(ctx, pal) {
    arrow(ctx, "down", pal);
  },
  smooth(ctx, pal) {
    ctx.strokeStyle = pal.light;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(0, 0, 23, -2.7, 1.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0.3, 3.8);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(9, -22);
    ctx.lineTo(20, -21);
    ctx.lineTo(14, -11);
    ctx.fillStyle = pal.light;
    ctx.fill();
  },
  brush(ctx, pal) {
    ctx.rotate(-0.55);
    ctx.fillStyle = lin(ctx, -4, -26, 4, 15, [[0, "#d7b170"], [1, "#4a2a10"]]);
    rrPath(ctx, -4, -26, 8, 42, 3);
    ctx.fill();
    edge(ctx, "#241307", 1);
    ctx.beginPath();
    ctx.moveTo(-10, 14);
    ctx.lineTo(10, 14);
    ctx.lineTo(7, 29);
    ctx.quadraticCurveTo(0, 34, -7, 29);
    ctx.closePath();
    ctx.fillStyle = rad(ctx, -3, 20, 18, [[0, pal.light], [0.5, pal.base], [1, pal.dark]]);
    ctx.fill();
    edge(ctx, pal.accent, 1.3);
  },
  grid(ctx, pal) {
    ctx.fillStyle = withAlpha(pal.dark, 0.35);
    rrPath(ctx, -26, -26, 52, 52, 6);
    ctx.fill();
    ctx.strokeStyle = pal.light;
    ctx.lineWidth = 2.2;
    for (const x of [-13, 0, 13]) {
      ctx.beginPath();
      ctx.moveTo(x, -25);
      ctx.lineTo(x, 25);
      ctx.stroke();
    }
    for (const y of [-13, 0, 13]) {
      ctx.beginPath();
      ctx.moveTo(-25, y);
      ctx.lineTo(25, y);
      ctx.stroke();
    }
  },
  lodBadge(ctx, pal) {
    diamond(ctx, 23);
    ctx.fillStyle = rad(ctx, -6, -8, 28, [[0, pal.light], [0.55, pal.base], [1, pal.dark]]);
    ctx.fill();
    edge(ctx, pal.accent, 1.7);
    noShadow(ctx);
    ctx.strokeStyle = withAlpha(pal.light, 0.8);
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(-10, 2);
    ctx.lineTo(-2, 10);
    ctx.lineTo(13, -10);
    ctx.stroke();
  },
  lock(ctx, pal) {
    ctx.strokeStyle = pal.light;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, -6, 12, Math.PI, 0);
    ctx.stroke();
    ctx.fillStyle = lin(ctx, 0, -2, 0, 25, [[0, pal.light], [0.55, pal.base], [1, pal.dark]]);
    rrPath(ctx, -17, -2, 34, 27, 5);
    ctx.fill();
    edge(ctx, pal.accent, 1.4);
  },
  warning(ctx, pal) {
    ctx.beginPath();
    ctx.moveTo(0, -28);
    ctx.lineTo(28, 23);
    ctx.lineTo(-28, 23);
    ctx.closePath();
    ctx.fillStyle = lin(ctx, 0, -28, 0, 23, [[0, pal.light], [0.45, pal.base], [1, pal.dark]]);
    ctx.fill();
    edge(ctx, pal.accent, 1.8);
    noShadow(ctx);
    ctx.fillStyle = pal.accent;
    rrPath(ctx, -2.4, -11, 4.8, 20, 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 16, 2.7, 0, TAU);
    ctx.fill();
  },
  wireframe(ctx, pal) {
    ctx.strokeStyle = pal.light;
    ctx.lineWidth = 2.2;
    for (const r of [13, 25]) {
      ctx.beginPath();
      ctx.rect(-r, -r, r * 2, r * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-25, -25);
    ctx.lineTo(25, 25);
    ctx.moveTo(25, -25);
    ctx.lineTo(-25, 25);
    ctx.stroke();
  },
  boundary(ctx, pal) {
    ctx.strokeStyle = pal.light;
    ctx.lineWidth = 4;
    ctx.setLineDash([9, 5]);
    ctx.strokeRect(-25, -25, 50, 50);
    ctx.setLineDash([]);
  },
  points(ctx, pal) {
    ctx.fillStyle = pal.light;
    for (const [x, y] of [[-18, -12], [-4, 7], [12, -16], [19, 14], [-15, 20], [3, -25]] as const) {
      ctx.beginPath();
      ctx.arc(x, y, 4.2, 0, TAU);
      ctx.fill();
      edge(ctx, pal.dark, 0.8);
    }
  },
  normalFan(ctx, pal) {
    ctx.strokeStyle = pal.light;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (const a of [-1.2, -0.4, 0.35, 1.05]) {
      ctx.beginPath();
      ctx.moveTo(0, 20);
      ctx.lineTo(Math.cos(a) * 26, Math.sin(a) * 26);
      ctx.stroke();
    }
    ctx.fillStyle = pal.base;
    ctx.beginPath();
    ctx.arc(0, 20, 7, 0, TAU);
    ctx.fill();
  },
  orbit(ctx, pal) {
    ctx.strokeStyle = pal.light;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, 0, 27, 15, -0.45, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(16, -12, 5, 0, TAU);
    ctx.fillStyle = pal.glow;
    ctx.fill();
  },
  player(ctx, pal) {
    ctx.beginPath();
    ctx.arc(0, -13, 8, 0, TAU);
    ctx.fillStyle = rad(ctx, -3, -16, 10, [[0, pal.light], [1, pal.base]]);
    ctx.fill();
    edge(ctx, pal.accent, 1.2);
    ctx.fillStyle = lin(ctx, 0, -4, 0, 25, [[0, pal.base], [1, pal.dark]]);
    rrPath(ctx, -12, -3, 24, 31, 8);
    ctx.fill();
    edge(ctx, pal.accent, 1.3);
  },
  importArrow(ctx, pal) {
    arrow(ctx, "down", pal);
  },
  exportArrow(ctx, pal) {
    arrow(ctx, "up", pal);
  },
  rebuild(ctx, pal) {
    ctx.strokeStyle = pal.light;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(0, 0, 24, -2.5, 0.9);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 24, 0.65, 3.95);
    ctx.stroke();
    ctx.fillStyle = pal.light;
    ctx.beginPath();
    ctx.moveTo(19, 1);
    ctx.lineTo(29, 0);
    ctx.lineTo(23, 10);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-19, -1);
    ctx.lineTo(-29, 0);
    ctx.lineTo(-23, -10);
    ctx.fill();
  },
  sigil(ctx, pal) {
    ctx.strokeStyle = pal.base;
    ctx.lineWidth = 3;
    ctx.shadowColor = pal.glow;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(0, 0, 21, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = pal.glow;
    ctx.lineWidth = 3.5;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(-9, 12);
    ctx.lineTo(-9, -12);
    ctx.lineTo(0, 2);
    ctx.lineTo(9, -12);
    ctx.lineTo(9, 12);
    ctx.stroke();
    noShadow(ctx);
  },
} satisfies Record<PrimitiveName, Painter>;
