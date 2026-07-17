export interface GpuTimestampSnapshot {
  supported: boolean;
  enabled: boolean;
  pending: boolean;
  skippedReadbacks: number;
  timingsMs: Readonly<Record<string, number>>;
}

interface ReadbackSlot {
  buffer: GPUBuffer;
  busy: boolean;
  destroyAfterMap: boolean;
}

const TIMESTAMP_BYTES = BigUint64Array.BYTES_PER_ELEMENT;
const READBACK_SLOTS = 2;
const DEFAULT_INTERVAL_FRAMES = 30;
const BUFFER_ALIGNMENT = 256;

export function gpuTimestampRecordingEnabled(
  search: string | URLSearchParams | undefined = currentSearchParams(),
): boolean {
  const params = search instanceof URLSearchParams ? search : new URLSearchParams(search ?? "");
  return parseBoolean(params.get("ringGpuTiming"))
    || parseBoolean(params.get("gpuTiming"))
    || parseBoolean(params.get("perfProbe"));
}

export class GpuTimestampRecorder {
  private readonly querySet: GPUQuerySet | null;
  private readonly resolveBuffer: GPUBuffer | null;
  private readonly readbacks: ReadbackSlot[];
  private readonly queryCount: number;
  private readonly resolveBytes: number;
  private readonly labelIndex = new Map<string, number>();
  private readonly timingsMsValue: Record<string, number> = {};
  private skippedReadbacks = 0;
  private generation = 0;

  constructor(
    private readonly device: GPUDevice,
    private readonly prefix: string,
    labels: readonly string[],
    private readonly intervalFrames = DEFAULT_INTERVAL_FRAMES,
    private readonly enabled = gpuTimestampRecordingEnabled(),
  ) {
    labels.forEach((label, index) => this.labelIndex.set(label, index));
    this.queryCount = Math.max(2, labels.length * 2);
    this.resolveBytes = roundUp(this.queryCount * TIMESTAMP_BYTES, BUFFER_ALIGNMENT);
    const supported = this.enabled && device.features.has("timestamp-query");
    this.querySet = supported
      ? device.createQuerySet({ label: `${prefix} timestamps`, type: "timestamp", count: this.queryCount })
      : null;
    this.resolveBuffer = supported
      ? device.createBuffer({
        label: `${prefix} timestamp resolve`,
        size: this.resolveBytes,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      })
      : null;
    this.readbacks = supported
      ? Array.from({ length: READBACK_SLOTS }, (_, index) => ({
        buffer: device.createBuffer({
          label: `${prefix} timestamp readback ${index}`,
          size: this.resolveBytes,
          usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        }),
        busy: false,
        destroyAfterMap: false,
      }))
      : [];
  }

  passDescriptor(label: string): GPUComputePassDescriptor {
    const index = this.labelIndex.get(label);
    if (!this.querySet || index === undefined) return { label: `${this.prefix}.${label}` };
    return {
      label: `${this.prefix}.${label}`,
      timestampWrites: {
        querySet: this.querySet,
        beginningOfPassWriteIndex: index * 2,
        endOfPassWriteIndex: index * 2 + 1,
      },
    };
  }

  encodeReadback(encoder: GPUCommandEncoder, frame: number): ReadbackSlot | null {
    if (!this.querySet || !this.resolveBuffer) return null;
    const interval = Math.max(1, Math.floor(this.intervalFrames));
    if (Math.max(0, Math.floor(frame)) % interval !== 0) return null;
    const slot = this.readbacks.find((candidate) => !candidate.busy) ?? null;
    if (!slot) {
      this.skippedReadbacks++;
      return null;
    }
    encoder.resolveQuerySet(this.querySet, 0, this.queryCount, this.resolveBuffer, 0);
    encoder.copyBufferToBuffer(this.resolveBuffer, 0, slot.buffer, 0, this.resolveBytes);
    slot.busy = true;
    slot.destroyAfterMap = false;
    return slot;
  }

  submitReadback(slot: ReadbackSlot | null): void {
    if (!slot) return;
    const generation = this.generation;
    void slot.buffer.mapAsync(GPUMapMode.READ).then(() => {
      if (generation !== this.generation) {
        slot.buffer.unmap();
        slot.busy = false;
        if (slot.destroyAfterMap) slot.buffer.destroy();
        return;
      }
      const raw = new BigUint64Array(slot.buffer.getMappedRange(0, this.queryCount * TIMESTAMP_BYTES).slice(0));
      slot.buffer.unmap();
      slot.busy = false;
      for (const [label, index] of this.labelIndex) {
        const begin = raw[index * 2] ?? 0n;
        const end = raw[index * 2 + 1] ?? 0n;
        if (end < begin) continue;
        this.timingsMsValue[label] = Number(end - begin) / 1_000_000;
      }
      this.publishCounters();
      if (slot.destroyAfterMap) {
        slot.destroyAfterMap = false;
        slot.buffer.destroy();
      }
    }).catch((error) => {
      slot.busy = false;
      if (slot.destroyAfterMap) {
        slot.destroyAfterMap = false;
        slot.buffer.destroy();
        return;
      }
      console.warn(`[${this.prefix}] GPU timestamp readback failed`, error);
    });
  }

  snapshot(): GpuTimestampSnapshot {
    return {
      supported: this.querySet !== null,
      enabled: this.enabled,
      pending: this.readbacks.some((slot) => slot.busy),
      skippedReadbacks: this.skippedReadbacks,
      timingsMs: { ...this.timingsMsValue },
    };
  }

  destroy(): void {
    this.generation++;
    this.querySet?.destroy();
    this.resolveBuffer?.destroy();
    for (const slot of this.readbacks) {
      if (slot.busy) slot.destroyAfterMap = true;
      else slot.buffer.destroy();
    }
  }

  private publishCounters(): void {
    const counters = globalCounters();
    if (!counters) return;
    counters[`${this.prefix}.gpuTiming.supported`] = this.querySet ? 1 : 0;
    counters[`${this.prefix}.gpuTiming.skippedReadbacks`] = this.skippedReadbacks;
    for (const [label, value] of Object.entries(this.timingsMsValue)) {
      counters[`${this.prefix}.gpuTiming.${label}Ms`] = value;
    }
  }
}

function roundUp(value: number, alignment: number): number {
  const safeAlignment = Math.max(1, Math.floor(alignment));
  return Math.ceil(Math.max(0, value) / safeAlignment) * safeAlignment;
}

function parseBoolean(value: string | null): boolean {
  return value === "1" || value === "true" || value === "on";
}

function currentSearchParams(): URLSearchParams {
  const maybeWindow = globalThis as typeof globalThis & { window?: { location?: { search?: string } } };
  return new URLSearchParams(maybeWindow.window?.location?.search ?? "");
}

function globalCounters(): Record<string, number> | null {
  return (globalThis as typeof globalThis & {
    window?: { __drusnielClod?: { stats?: { counters?: Record<string, number> } } };
  }).window?.__drusnielClod?.stats?.counters ?? null;
}
