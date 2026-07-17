export class ConstructionCollapseQueue {
  private readonly dueAtMs = new Map<string, number>();

  schedule(id: string, nowMs: number, delayMs: number): void {
    if (!this.dueAtMs.has(id)) this.dueAtMs.set(id, nowMs + Math.max(0, delayMs));
  }

  cancel(id: string): void {
    this.dueAtMs.delete(id);
  }

  clear(): void {
    this.dueAtMs.clear();
  }

  pendingCount(): number {
    return this.dueAtMs.size;
  }

  takeReady(nowMs: number, maxCount: number): readonly string[] {
    const limit = Math.max(0, Math.floor(maxCount));
    if (limit === 0) return [];
    const ready = [...this.dueAtMs.entries()]
      .filter(([, dueAt]) => dueAt <= nowMs)
      .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([id]) => id);
    for (const id of ready) this.dueAtMs.delete(id);
    return ready;
  }
}
