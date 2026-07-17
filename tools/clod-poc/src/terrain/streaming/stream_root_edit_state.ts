import { captureTerrainStreamingToken, type TerrainStreamingToken } from "../../stream/terrain_streaming_control.js";

export type StreamRootDirtySnapshot = ReadonlyMap<string, number>;

export class StreamRootEditState {
  private readonly dirtyVersions = new Map<string, number>();
  private readonly cpuAuthoritativeIds = new Set<string>();
  private readonly snapshotTokens = new WeakMap<object, TerrainStreamingToken>();

  markDirty(id: string): void {
    this.dirtyVersions.set(id, (this.dirtyVersions.get(id) ?? 0) + 1);
    this.cpuAuthoritativeIds.add(id);
  }

  cpuAuthoritative(ids: readonly string[]): string[] {
    return ids.filter((id) => this.cpuAuthoritativeIds.has(id));
  }

  requiresCpu(ids: readonly string[]): boolean {
    return this.cpuAuthoritative(ids).length > 0;
  }

  captureDirty(ids: readonly string[]): StreamRootDirtySnapshot {
    const snapshot = new Map<string, number>();
    for (const id of ids) {
      const revision = this.dirtyVersions.get(id);
      if (revision !== undefined) snapshot.set(id, revision);
    }
    this.snapshotTokens.set(snapshot, captureTerrainStreamingToken());
    return snapshot;
  }

  acknowledge(snapshot: StreamRootDirtySnapshot): void {
    if (!this.snapshotTokens.get(snapshot as object)?.isCurrent()) return;
    for (const [id, revision] of snapshot) {
      if (this.dirtyVersions.get(id) === revision) this.dirtyVersions.delete(id);
    }
  }

  reset(): void {
    this.dirtyVersions.clear();
    this.cpuAuthoritativeIds.clear();
  }
}
