import type { SavedPropInstance } from "../save/save_schema.js";
import { tileKeyString, type WorldTileKey } from "./tile_key.js";
import type { EnvironmentalPropLayer, PropCandidateAddress } from "./prop_identity.js";

export interface PropExclusionCounters {
  readonly prop_delta_count: number;
  readonly prop_exclusion_tiles: number;
}

export interface TileLayerKey {
  readonly tileKey: WorldTileKey;
  readonly layer: EnvironmentalPropLayer;
}

function key(tileKey: WorldTileKey, layer: EnvironmentalPropLayer): string {
  return `${tileKeyString(tileKey)}/${layer}`;
}

function excludingAddress(prop: SavedPropInstance | null | undefined): PropCandidateAddress | null {
  return prop && prop.environmental && prop.state !== "active" ? prop.environmental : null;
}

function sameAddress(a: PropCandidateAddress, b: PropCandidateAddress): boolean {
  return a.candidateIndex === b.candidateIndex && a.layer === b.layer
    && a.tileKey.x === b.tileKey.x && a.tileKey.z === b.tileKey.z;
}

export class SparsePropExclusionBitsets {
  private readonly wordsByTileLayer = new Map<string, Uint32Array>();
  /** candidateIndex -> number of non-active environmental props referencing it. */
  private readonly refCountsByTileLayer = new Map<string, Map<number, number>>();
  private readonly dirtyTileLayers = new Map<string, TileLayerKey>();
  private deltaCountValue = 0;

  static fromSavedProps(props: readonly SavedPropInstance[]): SparsePropExclusionBitsets {
    const result = new SparsePropExclusionBitsets();
    for (const prop of props) result.applyDelta(null, prop);
    return result;
  }

  /**
   * Incremental prop-level mutation: `previous` is the stored version being replaced
   * (null for a new prop), `next` the incoming version (null for a removal). Keeps
   * bits, refcounts, and `prop_delta_count` exactly equivalent to a full rebuild.
   */
  applyDelta(previous: SavedPropInstance | null, next: SavedPropInstance | null): void {
    const nextDeltaCount = this.deltaCountValue
      - (previous?.environmental ? 1 : 0)
      + (next?.environmental ? 1 : 0);
    if (nextDeltaCount < 0) throw new Error("prop exclusion delta count underflow");

    const previousAddress = excludingAddress(previous);
    const nextAddress = excludingAddress(next);
    if (previousAddress && nextAddress && sameAddress(previousAddress, nextAddress)) {
      this.deltaCountValue = nextDeltaCount;
      return;
    }

    if (previousAddress) this.adjustCandidate(previousAddress, -1);
    if (nextAddress) this.adjustCandidate(nextAddress, +1);
    this.deltaCountValue = nextDeltaCount;
  }

  /**
   * Candidate-level set-AND-clear primitive. Forces the candidate's refcount to 0/1;
   * prop-level mutations must go through applyDelta so duplicates stay refcounted.
   */
  setExcluded(address: PropCandidateAddress, excluded: boolean): void {
    const mapKey = key(address.tileKey, address.layer);
    const current = this.refCountsByTileLayer.get(mapKey)?.get(address.candidateIndex) ?? 0;
    const target = excluded ? Math.max(1, current) : 0;
    if (target !== current) this.adjustCandidate(address, target - current);
  }

  private adjustCandidate(address: PropCandidateAddress, delta: number): void {
    const mapKey = key(address.tileKey, address.layer);
    let refCounts = this.refCountsByTileLayer.get(mapKey);
    const current = refCounts?.get(address.candidateIndex) ?? 0;
    const next = current + delta;
    if (next < 0) throw new Error(`prop exclusion refcount underflow at ${mapKey}#${address.candidateIndex}`);

    if (next > 0) {
      if (!refCounts) {
        refCounts = new Map<number, number>();
        this.refCountsByTileLayer.set(mapKey, refCounts);
      }
      refCounts.set(address.candidateIndex, next);
    } else {
      refCounts?.delete(address.candidateIndex);
    }

    if ((current > 0) === (next > 0)) return;
    this.setBit(mapKey, address, next > 0);
    if (refCounts?.size === 0) {
      this.refCountsByTileLayer.delete(mapKey);
      this.wordsByTileLayer.delete(mapKey);
    }
  }

  private setBit(mapKey: string, address: PropCandidateAddress, on: boolean): void {
    const wordIndex = Math.floor(address.candidateIndex / 32);
    const mask = 1 << (address.candidateIndex & 31);
    const current = this.wordsByTileLayer.get(mapKey);
    const words = current && current.length > wordIndex
      ? current
      : (() => {
          const expanded = new Uint32Array(wordIndex + 1);
          if (current) expanded.set(current);
          this.wordsByTileLayer.set(mapKey, expanded);
          return expanded;
        })();
    words[wordIndex] = on ? (words[wordIndex] ?? 0) | mask : (words[wordIndex] ?? 0) & ~mask;
    this.dirtyTileLayers.set(mapKey, {
      tileKey: { x: address.tileKey.x, z: address.tileKey.z },
      layer: address.layer,
    });
  }

  isExcluded(address: PropCandidateAddress): boolean {
    const words = this.wordsByTileLayer.get(key(address.tileKey, address.layer));
    const word = words?.[Math.floor(address.candidateIndex / 32)] ?? 0;
    return (word & (1 << (address.candidateIndex & 31))) !== 0;
  }

  /**
   * Tile/layers whose words changed since the last call; consuming clears the set.
   * GPU consumers must re-upload exactly these (a fresh instance reports every
   * populated tile). A tile pruned to empty is reported too — gpuWords returns null.
   */
  consumeDirtyTileLayers(): TileLayerKey[] {
    const dirty = [...this.dirtyTileLayers.values()];
    this.dirtyTileLayers.clear();
    return dirty;
  }

  /** Copy suitable for queue.writeBuffer; absent tiles allocate nothing. */
  gpuWords(tileKey: WorldTileKey, layer: EnvironmentalPropLayer): Uint32Array | null {
    const words = this.wordsByTileLayer.get(key(tileKey, layer));
    return words ? words.slice() : null;
  }

  /** Semantic word equality (missing/trailing words count as zero) plus counter parity. */
  contentEquals(other: SparsePropExclusionBitsets): boolean {
    if (this.deltaCountValue !== other.deltaCountValue) return false;
    if (this.wordsByTileLayer.size !== other.wordsByTileLayer.size) return false;
    const keys = new Set([...this.wordsByTileLayer.keys(), ...other.wordsByTileLayer.keys()]);
    for (const mapKey of keys) {
      const a = this.wordsByTileLayer.get(mapKey);
      const b = other.wordsByTileLayer.get(mapKey);
      const length = Math.max(a?.length ?? 0, b?.length ?? 0);
      for (let i = 0; i < length; i++) {
        if ((a?.[i] ?? 0) !== (b?.[i] ?? 0)) return false;
      }
    }
    return true;
  }

  counters(): PropExclusionCounters {
    return {
      prop_delta_count: this.deltaCountValue,
      prop_exclusion_tiles: this.wordsByTileLayer.size,
    };
  }
}
