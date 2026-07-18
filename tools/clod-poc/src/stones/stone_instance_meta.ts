export const STONE_META_VARIANT_SCALE = 32;
export const STONE_META_UNDERWATER_FLAG = 16;
const STONE_META_SINK_MAX = STONE_META_UNDERWATER_FLAG - 0.0001;

export interface StoneInstanceMeta {
  variant: number;
  sinkDepth: number;
  underwater: boolean;
}

export function packStoneInstanceMeta(meta: StoneInstanceMeta): number {
  const variant = Math.max(0, Math.floor(finiteOr(meta.variant, 0)));
  const sinkDepth = Math.min(STONE_META_SINK_MAX, Math.max(0, finiteOr(meta.sinkDepth, 0)));
  return variant * STONE_META_VARIANT_SCALE
    + (meta.underwater ? STONE_META_UNDERWATER_FLAG : 0)
    + sinkDepth;
}

export function unpackStoneInstanceMeta(value: number): StoneInstanceMeta {
  const packed = Math.max(0, finiteOr(value, 0));
  const variant = Math.floor(packed / STONE_META_VARIANT_SCALE);
  const lane = packed - variant * STONE_META_VARIANT_SCALE;
  const underwater = lane >= STONE_META_UNDERWATER_FLAG;
  return {
    variant,
    underwater,
    sinkDepth: lane - (underwater ? STONE_META_UNDERWATER_FLAG : 0),
  };
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
