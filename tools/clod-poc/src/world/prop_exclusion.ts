import type { SavedPropInstance } from "../save/save_schema.js";
import { tileKeyString, type WorldTileKey } from "./tile_key.js";
import type { EnvironmentalPropLayer, PropCandidateAddress } from "./prop_identity.js";

export interface PropExclusionCounters {
  readonly prop_delta_count: number;
  readonly prop_exclusion_tiles: number;
}

function key(tileKey: WorldTileKey, layer: EnvironmentalPropLayer): string {
  return `${tileKeyString(tileKey)}/${layer}`;
}

export class SparsePropExclusionBitsets {
  private readonly wordsByTileLayer = new Map<string, Uint32Array>();
  private deltaCountValue = 0;

  static fromSavedProps(props: readonly SavedPropInstance[]): SparsePropExclusionBitsets {
    const result = new SparsePropExclusionBitsets();
    for (const prop of props) {
      if (prop.state !== "active" && prop.environmental) result.exclude(prop.environmental);
    }
    result.deltaCountValue = props.filter((prop) => prop.environmental !== undefined).length;
    return result;
  }

  exclude(address: PropCandidateAddress): void {
    const wordIndex = Math.floor(address.candidateIndex / 32);
    const mapKey = key(address.tileKey, address.layer);
    const current = this.wordsByTileLayer.get(mapKey);
    const words = current && current.length > wordIndex
      ? current
      : (() => {
          const expanded = new Uint32Array(wordIndex + 1);
          if (current) expanded.set(current);
          this.wordsByTileLayer.set(mapKey, expanded);
          return expanded;
        })();
    words[wordIndex] = (words[wordIndex] ?? 0) | (1 << (address.candidateIndex & 31));
  }

  isExcluded(address: PropCandidateAddress): boolean {
    const words = this.wordsByTileLayer.get(key(address.tileKey, address.layer));
    const word = words?.[Math.floor(address.candidateIndex / 32)] ?? 0;
    return (word & (1 << (address.candidateIndex & 31))) !== 0;
  }

  /** Copy suitable for queue.writeBuffer; absent tiles allocate nothing. */
  gpuWords(tileKey: WorldTileKey, layer: EnvironmentalPropLayer): Uint32Array | null {
    const words = this.wordsByTileLayer.get(key(tileKey, layer));
    return words ? words.slice() : null;
  }

  counters(): PropExclusionCounters {
    return {
      prop_delta_count: this.deltaCountValue,
      prop_exclusion_tiles: this.wordsByTileLayer.size,
    };
  }
}
