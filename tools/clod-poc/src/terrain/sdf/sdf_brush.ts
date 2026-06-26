export type SdfBrushShape = "sphere" | "cube" | "cylinder";
export type SdfBrushOp = "remove" | "add";

export interface SdfBrush {
  x: number;
  y: number;
  z: number;
  radius: number;
  height: number;
  shape: SdfBrushShape;
  op: SdfBrushOp;
  strength: number;
  falloff: number;
  materialSlot?: number;
}

export function sampleBrushSdf(
  shape: SdfBrushShape,
  dx: number,
  dy: number,
  dz: number,
  radius: number,
  height: number,
): number {
  switch (shape) {
    case "cube": {
      const qx = Math.abs(dx) - radius;
      const qy = Math.abs(dy) - height;
      const qz = Math.abs(dz) - radius;
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
      return outside + Math.min(Math.max(qx, qy, qz), 0);
    }
    case "cylinder": {
      const dRadial = Math.hypot(dx, dz) - radius;
      const dAxial = Math.abs(dy) - height;
      const outside = Math.hypot(Math.max(dRadial, 0), Math.max(dAxial, 0));
      return outside + Math.min(Math.max(dRadial, dAxial), 0);
    }
    case "sphere":
      return Math.hypot(dx, (dy * radius) / height, dz) - radius;
  }
}

export function applyBrushSdfToDensity(
  brush: SdfBrush,
  x: number,
  y: number,
  z: number,
  currentDensity: number,
): number {
  const sdf = sampleBrushSdf(
    brush.shape,
    x - brush.x,
    y - brush.y,
    z - brush.z,
    brush.radius,
    brush.height,
  );
  const full = brush.op === "add"
    ? Math.max(currentDensity, -sdf)
    : Math.min(currentDensity, sdf);
  const weight = brush.falloff > 0
    ? Math.min(1, Math.max(0, -sdf / Math.max(1e-3, brush.falloff * brush.radius))) * brush.strength
    : sdf <= 0 ? brush.strength : 0;
  return currentDensity + (full - currentDensity) * weight;
}
