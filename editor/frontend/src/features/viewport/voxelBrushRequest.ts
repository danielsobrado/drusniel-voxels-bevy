import type { BrushSettings } from "../../types/editor";
import type { BlockType } from "../../types/world";
import type { RuntimeVoxelBrushRequest } from "../../runtime/runtimeSchemas";

export const buildRuntimeVoxelBrushRequest = (
  brush: BrushSettings,
  position: readonly [number, number, number],
  block: BlockType,
): RuntimeVoxelBrushRequest => ({
  position,
  action: brush.action,
  shape: brush.brushShape,
  block,
  radius: brush.radius,
  size: brush.size,
  mask: brush.mask,
  maskBlock: brush.mask === "material" ? brush.maskBlockId : undefined,
});
