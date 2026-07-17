import type { ConstructionSnapResult } from "./types.js";

function wrapIndex(value: number, count: number): number {
  return ((value % count) + count) % count;
}

export class ConstructionSnapSelector {
  private currentKey: string | null = null;
  private pendingCycle = 0;

  reset(): void {
    this.currentKey = null;
    this.pendingCycle = 0;
  }

  cycle(direction: number): void {
    this.pendingCycle += Math.sign(direction);
  }

  selectedKey(): string | null {
    return this.currentKey;
  }

  select(
    candidates: readonly ConstructionSnapResult[],
    captureRadiusM: number,
    releaseRadiusMultiplier: number,
  ): ConstructionSnapResult | null {
    if (candidates.length === 0) {
      this.reset();
      return null;
    }

    const currentIndex = this.currentKey
      ? candidates.findIndex((candidate) => candidate.key === this.currentKey)
      : -1;

    if (this.pendingCycle !== 0) {
      const start = currentIndex >= 0 ? currentIndex : 0;
      const next = candidates[wrapIndex(start + this.pendingCycle, candidates.length)]!;
      this.pendingCycle = 0;
      this.currentKey = next.key ?? null;
      return next;
    }

    if (currentIndex >= 0) {
      const current = candidates[currentIndex]!;
      const releaseRadius = captureRadiusM * Math.max(1, releaseRadiusMultiplier);
      if ((current.rayDistanceM ?? 0) <= releaseRadius) return current;
    }

    const captured = candidates.find((candidate) => (candidate.rayDistanceM ?? 0) <= captureRadiusM) ?? null;
    this.currentKey = captured?.key ?? null;
    return captured;
  }
}
