export interface TreeImpostorBakeClock {
  now(): number;
  nextFrame(): Promise<void>;
}

export class TreeImpostorFrameBudget {
  private frameStartedMs: number;
  private lastFrameMs = 0;

  constructor(
    readonly maxMsPerFrame: number,
    private readonly clock: TreeImpostorBakeClock = browserTreeImpostorBakeClock(),
  ) {
    this.frameStartedMs = this.clock.now();
  }

  elapsedMs(): number {
    return Math.max(0, this.clock.now() - this.frameStartedMs);
  }

  reportedFrameMs(): number {
    return this.lastFrameMs;
  }

  async yieldIfExpired(force = false): Promise<boolean> {
    const elapsed = this.elapsedMs();
    if (!force && elapsed < this.maxMsPerFrame) return false;
    this.lastFrameMs = elapsed;
    await this.clock.nextFrame();
    this.frameStartedMs = this.clock.now();
    return true;
  }
}

export function throwIfTreeImpostorBakeAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const reason = typeof signal.reason === "string" ? signal.reason : "tree impostor baking cancelled";
  throw new DOMException(reason, "AbortError");
}

export function isTreeImpostorBakeAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function browserTreeImpostorBakeClock(): TreeImpostorBakeClock {
  return {
    now: () => typeof performance !== "undefined" ? performance.now() : Date.now(),
    nextFrame: () => new Promise((resolve) => {
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
      else setTimeout(resolve, 0);
    }),
  };
}
