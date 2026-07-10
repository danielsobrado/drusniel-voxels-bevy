export type DirtyRegionRevisionSnapshot = ReadonlyMap<string, number>;

export class SaveDirtyRegionRevisions {
  private readonly revisions = new Map<string, number>();

  get size(): number {
    return this.revisions.size;
  }

  mark(regionKeys: Iterable<string>, revision: number): void {
    for (const regionKey of regionKeys) this.revisions.set(regionKey, revision);
  }

  keys(): string[] {
    return [...this.revisions.keys()].sort();
  }

  capture(regionKeys: Iterable<string>): DirtyRegionRevisionSnapshot {
    const snapshot = new Map<string, number>();
    for (const regionKey of regionKeys) {
      const revision = this.revisions.get(regionKey);
      if (revision !== undefined) snapshot.set(regionKey, revision);
    }
    return snapshot;
  }

  acknowledge(
    writtenRegionKeys: Iterable<string>,
    snapshot: DirtyRegionRevisionSnapshot,
  ): string[] {
    const acknowledged: string[] = [];
    for (const regionKey of writtenRegionKeys) {
      const writtenRevision = snapshot.get(regionKey);
      if (writtenRevision === undefined || this.revisions.get(regionKey) !== writtenRevision) continue;
      this.revisions.delete(regionKey);
      acknowledged.push(regionKey);
    }
    return acknowledged;
  }
}
