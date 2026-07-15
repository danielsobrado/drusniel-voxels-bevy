export const DRESSING_ANCHOR_KINDS = [
  "trunk_low",
  "trunk_mid",
  "trunk_high",
  "root_flare",
  "branch_dead",
  "log_top",
  "log_side",
  "log_end",
  "stump_top",
  "stump_side",
  "rock_shaded",
  "rock_exposed",
  "rock_crack",
] as const;

export type DressingAnchorKind = typeof DRESSING_ANCHOR_KINDS[number];

export interface DressingAttachmentAnchor {
  readonly slot: number;
  readonly kind: DressingAnchorKind;
  readonly positionLocal: readonly [number, number, number];
  readonly normalLocal: readonly [number, number, number];
  readonly tangentLocal: readonly [number, number, number];
  readonly radiusM: number;
  readonly exposure01: number;
}

export function validateAttachmentAnchors(anchors: readonly DressingAttachmentAnchor[]): void {
  const slots = new Set<number>();
  for (const anchor of anchors) {
    if (!Number.isSafeInteger(anchor.slot) || anchor.slot < 0) throw new Error("attachment anchor slot must be a non-negative integer");
    if (slots.has(anchor.slot)) throw new Error(`duplicate attachment anchor slot: ${anchor.slot}`);
    slots.add(anchor.slot);
    if (!DRESSING_ANCHOR_KINDS.includes(anchor.kind)) throw new Error(`unknown attachment anchor kind: ${String(anchor.kind)}`);
    if (!(anchor.radiusM > 0)) throw new Error("attachment anchor radius must be positive");
  }
}
