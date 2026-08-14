import {
  importAzgaarFullJson,
  type AzgaarFullJsonDocument,
  type AzgaarImportedWorld,
} from "./azgaar_json_importer.js";
import type { AzgaarImportConfig, AzgaarImportOptions } from "./azgaar_macro_world_source.js";

type Pending = {
  resolve: (world: AzgaarImportedWorld) => void;
  reject: (error: Error) => void;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isImportedWorld(value: unknown): value is AzgaarImportedWorld {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<AzgaarImportedWorld>;
  return candidate.format === "azgaar-imported-v1"
    && candidate.version === 1
    && typeof candidate.baseTerrain === "object"
    && candidate.baseTerrain !== null
    && typeof candidate.campaign === "object"
    && candidate.campaign !== null;
}

export class AzgaarImportWorkerClient {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private worker: Worker | null = null;
  private disposed = false;

  constructor() {
    if (typeof Worker !== "function") return;

    try {
      this.worker = new Worker(new URL("./azgaar_import.worker.ts", import.meta.url), { type: "module" });
    } catch {
      return;
    }

    this.worker.addEventListener("message", (event) => this.onMessage(event));
    this.worker.addEventListener("error", (event) => this.onError(event));
    this.worker.addEventListener("messageerror", () => {
      this.failWorker(new Error("Azgaar import worker response could not be deserialized."));
    });
  }

  convert(
    document: AzgaarFullJsonDocument,
    config: AzgaarImportConfig,
    options: AzgaarImportOptions = {},
  ): Promise<AzgaarImportedWorld> {
    if (this.disposed) {
      return Promise.reject(new Error("Azgaar import worker was disposed."));
    }

    const worker = this.worker;
    if (!worker) {
      return Promise.resolve().then(() => importAzgaarFullJson(document, config, options));
    }

    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        worker.postMessage({ id, document, config, options });
      } catch (error) {
        this.failWorker(new Error(`Azgaar import worker postMessage failed: ${errorMessage(error)}`));
      }
    });
  }

  private onMessage(event: MessageEvent<unknown>): void {
    const data = event.data;
    if (typeof data !== "object" || data === null) {
      this.failWorker(new Error("Azgaar import worker returned an invalid protocol message."));
      return;
    }

    const response = data as { id?: unknown; world?: unknown; error?: unknown };
    if (!Number.isSafeInteger(response.id) || (response.id as number) < 1) {
      this.failWorker(new Error("Azgaar import worker returned an invalid protocol message."));
      return;
    }

    const id = response.id as number;
    const pending = this.pending.get(id);
    if (!pending) return;

    if (typeof response.error === "string") {
      this.pending.delete(id);
      pending.reject(new Error(response.error));
      return;
    }

    if (!isImportedWorld(response.world)) {
      this.failWorker(new Error("Azgaar import worker returned an invalid protocol message."));
      return;
    }

    this.pending.delete(id);
    pending.resolve(response.world);
  }

  private onError(event: ErrorEvent): void {
    this.failWorker(new Error(event.message || "Azgaar import worker failed."));
  }

  private failWorker(error: Error): void {
    const worker = this.worker;
    this.worker = null;
    worker?.terminate();
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.failWorker(new Error("Azgaar import worker was disposed."));
  }
}
