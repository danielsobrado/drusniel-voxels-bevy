const TIMESTAMP_BYTES = BigUint64Array.BYTES_PER_ELEMENT;

export interface ErosionGpuTimingBatch {
  readonly supported: boolean;
  passDescriptor(label: string): GPUComputePassDescriptor;
  encodeResolve(encoder: GPUCommandEncoder): void;
  collect(): Promise<Readonly<Record<string, number>>>;
  destroy(): void;
}

class UnsupportedTimingBatch implements ErosionGpuTimingBatch {
  readonly supported = false;

  passDescriptor(label: string): GPUComputePassDescriptor {
    return { label };
  }

  encodeResolve(_encoder: GPUCommandEncoder): void {}

  async collect(): Promise<Readonly<Record<string, number>>> {
    return Object.freeze({});
  }

  destroy(): void {}
}

class TimestampTimingBatch implements ErosionGpuTimingBatch {
  readonly supported = true;
  private readonly querySet: GPUQuerySet;
  private readonly resolveBuffer: GPUBuffer;
  private readonly readbackBuffer: GPUBuffer;
  private readonly labels: string[] = [];
  private nextQuery = 0;
  private resolved = false;

  constructor(device: GPUDevice, maxPasses: number) {
    const queryCount = Math.max(2, maxPasses * 2);
    const byteLength = queryCount * TIMESTAMP_BYTES;
    this.querySet = device.createQuerySet({ label: "erosion-pass-timestamps", type: "timestamp", count: queryCount });
    this.resolveBuffer = device.createBuffer({
      label: "erosion-pass-timestamps-resolve",
      size: byteLength,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    this.readbackBuffer = device.createBuffer({
      label: "erosion-pass-timestamps-readback",
      size: byteLength,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  }

  passDescriptor(label: string): GPUComputePassDescriptor {
    if (this.nextQuery + 1 >= this.querySet.count) throw new Error("erosion GPU timestamp query capacity exceeded");
    const begin = this.nextQuery;
    this.nextQuery += 2;
    this.labels.push(label);
    return {
      label,
      timestampWrites: {
        querySet: this.querySet,
        beginningOfPassWriteIndex: begin,
        endOfPassWriteIndex: begin + 1,
      },
    };
  }

  encodeResolve(encoder: GPUCommandEncoder): void {
    if (this.nextQuery === 0) return;
    const byteLength = this.nextQuery * TIMESTAMP_BYTES;
    encoder.resolveQuerySet(this.querySet, 0, this.nextQuery, this.resolveBuffer, 0);
    encoder.copyBufferToBuffer(this.resolveBuffer, 0, this.readbackBuffer, 0, byteLength);
    this.resolved = true;
  }

  async collect(): Promise<Readonly<Record<string, number>>> {
    if (!this.resolved || this.nextQuery === 0) return Object.freeze({});
    await this.readbackBuffer.mapAsync(GPUMapMode.READ, 0, this.nextQuery * TIMESTAMP_BYTES);
    const timestamps = new BigUint64Array(this.readbackBuffer.getMappedRange(0, this.nextQuery * TIMESTAMP_BYTES));
    const totals: Record<string, number> = {};
    for (let pass = 0; pass < this.labels.length; pass++) {
      const begin = timestamps[pass * 2] ?? 0n;
      const end = timestamps[pass * 2 + 1] ?? begin;
      const elapsedMs = Number(end >= begin ? end - begin : 0n) / 1_000_000;
      const label = this.labels[pass]!;
      totals[label] = (totals[label] ?? 0) + elapsedMs;
    }
    this.readbackBuffer.unmap();
    return Object.freeze(totals);
  }

  destroy(): void {
    this.querySet.destroy();
    this.resolveBuffer.destroy();
    this.readbackBuffer.destroy();
  }
}

export function createErosionGpuTimingBatch(device: GPUDevice, maxPasses: number): ErosionGpuTimingBatch {
  return device.features.has("timestamp-query")
    ? new TimestampTimingBatch(device, maxPasses)
    : new UnsupportedTimingBatch();
}

export function mergeErosionGpuPassTimings(
  target: Record<string, number>,
  source: Readonly<Record<string, number>>,
): void {
  for (const [label, elapsedMs] of Object.entries(source)) target[label] = (target[label] ?? 0) + elapsedMs;
}
