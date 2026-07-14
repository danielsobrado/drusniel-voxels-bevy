export const PROCEDURAL_TERRAIN_DETAIL_SCALE_GAIN = 1.5;

const DEFAULT_SLOT_SCALE = 1 / 64;
const MIN_EFFECTIVE_SCALE = 1 / 512;
const MAX_EFFECTIVE_SCALE = 2;

export function resolveTerrainTextureScale(
  slotScale: number,
  userScale: number,
  procedural: boolean,
): number {
  const safeSlotScale = Number.isFinite(slotScale) && slotScale > 0
    ? slotScale
    : DEFAULT_SLOT_SCALE;
  const safeUserScale = Number.isFinite(userScale) && userScale > 0
    ? userScale
    : 1;
  const detailGain = procedural ? PROCEDURAL_TERRAIN_DETAIL_SCALE_GAIN : 1;
  return Math.min(
    MAX_EFFECTIVE_SCALE,
    Math.max(MIN_EFFECTIVE_SCALE, safeSlotScale * safeUserScale * detailGain),
  );
}
