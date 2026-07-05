import type { ClodCacheStreamingConfig } from "./cacheConfig.js";

type ReadTask<T> = {
  kind: "read";
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

type WriteTask<T> = {
  kind: "write";
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

export class CacheScheduler {
  private readonly config: ClodCacheStreamingConfig;
  private readonly readQueue: ReadTask<unknown>[] = [];
  private readonly writeQueue: WriteTask<unknown>[] = [];
  private readonly idleWaiters: Array<() => void> = [];
  private draining = false;
  private activeTasks = 0;

  constructor(config: ClodCacheStreamingConfig) {
    this.config = config;
  }

  get pendingReads(): number {
    return this.readQueue.length;
  }

  get pendingWrites(): number {
    return this.writeQueue.length;
  }

  scheduleRead<T>(run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.readQueue.push({ kind: "read", run, resolve: resolve as (v: unknown) => void, reject });
      this.scheduleDrain();
    });
  }

  scheduleWrite<T>(run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.writeQueue.push({ kind: "write", run, resolve: resolve as (v: unknown) => void, reject });
      this.scheduleDrain();
    });
  }

  async flush(): Promise<void> {
    while (this.hasPendingWork()) {
      if (this.readQueue.length > 0 || this.writeQueue.length > 0) {
        await this.drainOnce();
      } else {
        await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
      }
    }
  }

  private hasPendingWork(): boolean {
    return this.readQueue.length > 0 || this.writeQueue.length > 0 || this.activeTasks > 0;
  }

  private notifyIdleIfNeeded(): void {
    if (this.hasPendingWork()) return;
    while (this.idleWaiters.length > 0) this.idleWaiters.shift()?.();
  }

  private scheduleDrain(): void {
    if (this.draining) return;
    this.draining = true;
    const tick = () => {
      void this.drainOnce().finally(() => {
        if (this.readQueue.length > 0 || this.writeQueue.length > 0) {
          if (typeof requestAnimationFrame === "function") requestAnimationFrame(tick);
          else setTimeout(tick, 0);
        } else {
          this.draining = false;
          this.notifyIdleIfNeeded();
        }
      });
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(tick);
    else setTimeout(tick, 0);
  }

  private async runTask<T>(task: ReadTask<T> | WriteTask<T>): Promise<void> {
    this.activeTasks++;
    try {
      const result = await task.run();
      task.resolve(result);
    } catch (error) {
      task.reject(error);
    } finally {
      this.activeTasks--;
      this.notifyIdleIfNeeded();
    }
  }

  private async drainOnce(): Promise<void> {
    const started = performance.now();
    let reads = 0;
    let writes = 0;

    // TODO: frame-budget enforcement is approximate; refine with rAF timing hooks.
    while (reads < this.config.read_budget_per_frame) {
      const elapsed = performance.now() - started;
      if (elapsed >= this.config.max_decode_ms_per_frame) break;
      const task = this.readQueue.shift();
      if (!task) break;
      await this.runTask(task);
      reads++;
    }

    while (writes < this.config.write_budget_per_frame) {
      const elapsed = performance.now() - started;
      if (elapsed >= this.config.max_encode_ms_per_frame) break;
      const task = this.writeQueue.shift();
      if (!task) break;
      await this.runTask(task);
      writes++;
    }
  }
}
