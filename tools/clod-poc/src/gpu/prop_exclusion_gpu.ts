import type { EnvironmentalPropLayer } from "../world/prop_identity.js";
import type { SparsePropExclusionBitsets } from "../world/prop_exclusion.js";
import { tileKeyString, type WorldTileKey } from "../world/tile_key.js";

interface UploadedExclusion {
  readonly buffer: GPUBuffer;
  readonly wordCount: number;
}

/** Sparse storage-buffer uploader used by placement computes before dispatch. */
export class PropExclusionGpuBuffers {
  private readonly uploaded = new Map<string, UploadedExclusion>();

  constructor(private readonly device: GPUDevice) {}

  upload(exclusions: SparsePropExclusionBitsets, tileKey: WorldTileKey, layer: EnvironmentalPropLayer): UploadedExclusion | null {
    const words = exclusions.gpuWords(tileKey, layer);
    const mapKey = `${tileKeyString(tileKey)}/${layer}`;
    const previous = this.uploaded.get(mapKey);
    if (!words) {
      previous?.buffer.destroy();
      this.uploaded.delete(mapKey);
      return null;
    }
    const byteLength = Math.max(4, words.byteLength);
    let entry = previous;
    if (!entry || entry.buffer.size < byteLength) {
      entry?.buffer.destroy();
      entry = {
        buffer: this.device.createBuffer({
          label: `prop-exclusions:${mapKey}`,
          size: byteLength,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        }),
        wordCount: words.length,
      };
      this.uploaded.set(mapKey, entry);
    }
    const upload = new Uint32Array(words.length);
    upload.set(words);
    this.device.queue.writeBuffer(entry.buffer, 0, upload.buffer);
    return { buffer: entry.buffer, wordCount: words.length };
  }

  dispose(): void {
    for (const entry of this.uploaded.values()) entry.buffer.destroy();
    this.uploaded.clear();
  }
}

/** WGSL-side contract shared by tree/stone placement shaders that bind the sparse words. */
export const PROP_EXCLUSION_WGSL = `
fn prop_candidate_excluded(candidate_index: u32, exclusion_word_count: u32) -> bool {
  let word_index = candidate_index >> 5u;
  if (word_index >= exclusion_word_count) { return false; }
  return (prop_exclusion_words[word_index] & (1u << (candidate_index & 31u))) != 0u;
}`;
