/** Dequeue the next parent rebuild key, level-ordered (L1 fully drains before L2, etc.). */
export function nextPendingParentLevelOrdered(
  pendingByLevel: Map<number, Set<string>>,
  topLevel: number,
): { level: number; key: string } | null {
  for (let level = 1; level <= topLevel; level++) {
    const set = pendingByLevel.get(level);
    if (!set || set.size === 0) continue;
    // A parent at level L must read freshly resimplified children at L-1. Interleaving
    // levels lets L2/L3 rebuild from stale siblings and fail InternalBorderNotWelded.
    if (level > 1 && (pendingByLevel.get(level - 1)?.size ?? 0) > 0) return null;
    const key = set.values().next().value as string;
    set.delete(key);
    return { level, key };
  }
  return null;
}
