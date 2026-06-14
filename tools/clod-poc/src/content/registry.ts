import { ContentRegistry } from "./types.js";

/** Maps a numeric texture slot index to a semantic TextureSlot ID. */
export function getTextureSlotIdFromIndex(index: number, registry: ContentRegistry): string {
  for (const slot of registry.textureSlots.values()) {
    if (slot.slotIndex === index) {
      return slot.id;
    }
  }
  return "natural";
}

/** Maps a semantic TextureSlot ID to its numeric slot index. */
export function getTextureSlotIndexFromId(id: string, registry: ContentRegistry): number {
  const slot = registry.textureSlots.get(id);
  return slot ? slot.slotIndex : 0;
}

/** Maps a numeric material slot index (which typically aligns with texture slot index) to a semantic Material ID. */
export function getMaterialIdFromSlotIndex(index: number, registry: ContentRegistry): string {
  const slot = Array.from(registry.textureSlots.values()).find(s => s.slotIndex === index);
  if (slot && slot.materialId) {
    return slot.materialId;
  }
  const fallbacks: Record<number, string> = {
    0: "top-soil",
    1: "top-soil",
    2: "sub-soil",
    3: "rock",
    4: "sand",
    5: "water",
    6: "snow",
    7: "lava",
  };
  return fallbacks[index] ?? "top-soil";
}
