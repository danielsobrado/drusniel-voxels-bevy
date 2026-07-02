import { LIGHT_SAMPLE, type LightTile } from "./light_builder.js";
import type { SunLightOptions } from "./sun_light_options.js";

export interface SunLightDebugOverlay {
  update(tiles: readonly LightTile[], options: SunLightOptions): void;
  dispose(): void;
}

function stylePanel(root: HTMLDivElement): void {
  root.style.position = "fixed";
  root.style.right = "12px";
  root.style.bottom = "12px";
  root.style.zIndex = "1000";
  root.style.padding = "8px";
  root.style.background = "rgba(8, 10, 14, 0.78)";
  root.style.border = "1px solid rgba(255,255,255,0.2)";
  root.style.borderRadius = "8px";
  root.style.color = "white";
  root.style.font = "12px monospace";
  root.style.pointerEvents = "none";
}

function drawTile(ctx: CanvasRenderingContext2D, tile: LightTile, x: number, y: number, size: number): void {
  const cellSize = size / tile.resolution;
  for (let cellZ = 0; cellZ < tile.resolution; cellZ++) {
    for (let cellX = 0; cellX < tile.resolution; cellX++) {
      const value = tile.values[cellZ * tile.resolution + cellX] ?? LIGHT_SAMPLE.missing;
      if (value === LIGHT_SAMPLE.lit) ctx.fillStyle = "rgb(235, 235, 210)";
      else if (value === LIGHT_SAMPLE.shaded) ctx.fillStyle = "rgb(35, 38, 45)";
      else ctx.fillStyle = "rgb(105, 105, 115)";
      ctx.fillRect(x + cellX * cellSize, y + cellZ * cellSize, Math.ceil(cellSize), Math.ceil(cellSize));
    }
  }
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.strokeRect(x, y, size, size);
}

export function createSunLightDebugOverlay(parent: HTMLElement = document.body): SunLightDebugOverlay {
  const root = document.createElement("div");
  const title = document.createElement("div");
  const canvas = document.createElement("canvas");
  stylePanel(root);
  title.textContent = "sun light cache";
  title.style.marginBottom = "6px";
  canvas.width = 192;
  canvas.height = 192;
  root.hidden = true;
  root.append(title, canvas);
  parent.appendChild(root);

  return {
    update(tiles: readonly LightTile[], options: SunLightOptions): void {
      root.hidden = !options.debugView.active;
      if (root.hidden) return;
      const selected = tiles.slice(-options.debugView.maxDebugTiles);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const count = Math.max(1, selected.length);
      const columns = Math.ceil(Math.sqrt(count));
      const rows = Math.ceil(count / columns);
      const tileSize = Math.floor(Math.min(canvas.width / columns, canvas.height / rows));
      selected.forEach((tile, index) => {
        const x = (index % columns) * tileSize;
        const y = Math.floor(index / columns) * tileSize;
        drawTile(ctx, tile, x, y, tileSize);
      });
      title.textContent = `sun light cache (${selected.length})`;
    },
    dispose(): void {
      root.remove();
    },
  };
}
