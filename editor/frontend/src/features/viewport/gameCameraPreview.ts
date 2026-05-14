import type { WorldSurfaceSample } from "../../types/world";
import { MATERIAL_COLORS } from "./voxelGeometry";

export interface GameCameraState {
  readonly position: readonly [number, number, number];
  readonly yaw: number;
}

export interface DetachedGameCameraSnapshot {
  readonly camera: GameCameraState;
  readonly samples: readonly WorldSurfaceSample[];
  readonly cellSize: number;
  readonly updatedAt: number;
}

export const DETACHED_GAME_CAMERA_CHANNEL = "drusniel-game-camera-preview";
export const DETACHED_GAME_CAMERA_STORAGE_KEY = "drusniel.editor.detachedGameCamera";
export const DETACHED_GAME_CAMERA_WINDOW_LABEL = "game-camera-preview";

const sampleGridKey = (x: number, z: number) => `${x}:${z}`;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const drawGameCameraPreview = (
  ctx: CanvasRenderingContext2D,
  samples: readonly WorldSurfaceSample[],
  camera: GameCameraState,
  cellSize: number,
  width: number,
  height: number,
) => {
  ctx.clearRect(0, 0, width, height);
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#182636");
  sky.addColorStop(0.55, "#101821");
  sky.addColorStop(1, "#0a0d12");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  const horizon = height * 0.48;
  ctx.fillStyle = "rgba(5, 7, 10, 0.52)";
  ctx.fillRect(0, horizon, width, height - horizon);

  const sampleMap = new Map(samples.map((sample) => [sampleGridKey(sample.x, sample.z), sample]));
  const forwardX = Math.cos(camera.yaw);
  const forwardZ = Math.sin(camera.yaw);
  const rightX = -forwardZ;
  const rightZ = forwardX;
  const focal = width * 0.74;
  const drawItems = samples
    .map((sample) => {
      const dx = sample.x + cellSize * 0.5 - camera.position[0];
      const dz = sample.z + cellSize * 0.5 - camera.position[2];
      const depth = dx * forwardX + dz * forwardZ;
      if (depth <= 2 || depth > 160) {
        return null;
      }
      const lateral = dx * rightX + dz * rightZ;
      const screenX = width * 0.5 + (lateral / depth) * focal;
      const size = clamp((cellSize / depth) * focal, 2, 52);
      if (screenX < -size || screenX > width + size) {
        return null;
      }

      const neighbors = [
        sampleMap.get(sampleGridKey(sample.x + cellSize, sample.z)),
        sampleMap.get(sampleGridKey(sample.x - cellSize, sample.z)),
        sampleMap.get(sampleGridKey(sample.x, sample.z + cellSize)),
        sampleMap.get(sampleGridKey(sample.x, sample.z - cellSize)),
      ].filter((neighbor): neighbor is WorldSurfaceSample => Boolean(neighbor));
      const baseHeight = Math.min(sample.height - 1, ...neighbors.map((neighbor) => neighbor.height));
      const topY = horizon + ((camera.position[1] - sample.height) / depth) * focal * 0.62;
      const bottomY = horizon + ((camera.position[1] - baseHeight) / depth) * focal * 0.62;
      return { sample, depth, screenX, size, topY, bottomY };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => right.depth - left.depth);

  for (const item of drawItems) {
    const materialColor = MATERIAL_COLORS[item.sample.material] ?? MATERIAL_COLORS.Rock;
    const half = item.size * 0.5;
    const topHeight = item.size * 0.24;
    const bottomY = Math.max(item.topY + 2, item.bottomY);

    ctx.fillStyle = item.sample.water ? "rgba(74, 184, 234, 0.7)" : materialColor;
    ctx.strokeStyle = "rgba(4, 6, 10, 0.78)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(item.screenX - half, item.topY, item.size, bottomY - item.topY);
    ctx.fill();
    ctx.stroke();

    ctx.globalAlpha = item.sample.water ? 0.72 : 1;
    ctx.beginPath();
    ctx.moveTo(item.screenX, item.topY - topHeight);
    ctx.lineTo(item.screenX + half, item.topY);
    ctx.lineTo(item.screenX, item.topY + topHeight);
    ctx.lineTo(item.screenX - half, item.topY);
    ctx.closePath();
    ctx.fillStyle = item.sample.water ? "#65c7ff" : materialColor;
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
  ctx.beginPath();
  ctx.moveTo(width * 0.5 - 10, height * 0.5);
  ctx.lineTo(width * 0.5 + 10, height * 0.5);
  ctx.moveTo(width * 0.5, height * 0.5 - 10);
  ctx.lineTo(width * 0.5, height * 0.5 + 10);
  ctx.stroke();
};

export const renderGameCameraPreviewCanvas = (
  canvas: HTMLCanvasElement,
  samples: readonly WorldSurfaceSample[],
  camera: GameCameraState,
  cellSize: number,
  width: number,
  height: number,
  dpr = window.devicePixelRatio || 1,
) => {
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawGameCameraPreview(ctx, samples, camera, cellSize, width, height);
};
