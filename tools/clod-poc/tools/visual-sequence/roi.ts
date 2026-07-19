export interface ScreenPoint { x: number; y: number }

export function rasterizePolylineRoi(width: number, height: number, points: readonly ScreenPoint[], radiusPx: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  if (points.length < 2) return mask;
  const radius = Math.max(0, radiusPx);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const center = { x: x + 0.5, y: y + 0.5 };
    for (let index = 1; index < points.length; index++) {
      if (distanceToSegment(center, points[index - 1]!, points[index]!) <= radius) {
        mask[y * width + x] = 1;
        break;
      }
    }
  }
  return mask;
}

export function rasterizeAnnulusRoi(width: number, height: number, center: ScreenPoint, innerRadius: number, outerRadius: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  const inner2 = innerRadius * innerRadius;
  const outer2 = outerRadius * outerRadius;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = x + 0.5 - center.x;
    const dy = y + 0.5 - center.y;
    const distance2 = dx * dx + dy * dy;
    if (distance2 >= inner2 && distance2 <= outer2) mask[y * width + x] = 1;
  }
  return mask;
}

function distanceToSegment(point: ScreenPoint, start: ScreenPoint, end: ScreenPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length2 = dx * dx + dy * dy;
  if (length2 === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length2));
  return Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t));
}
