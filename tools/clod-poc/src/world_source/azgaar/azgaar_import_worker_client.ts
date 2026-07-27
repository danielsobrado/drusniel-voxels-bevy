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

export class AzgaarImportWorkerClient {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private worker: Worker | null;

  constructor() {
    this.worker = typeof Worker === "function"
      ? new Worker(new URL("./azgaar_import.worker.ts", import.meta.url), { type: "module" })
      : null;
    if (this.worker) {
      this.worker.addEventListener("message", (event) => this.onMessage(event));
      this.worker.addEventListener("error", (event) => this.onError(event));
    }
  }

  convert(
    document: AzgaarFullJsonDocument,
    config: AzgaarImportConfig,
    options: AzgaarImportOptions = {},
  ): Promise<AzgaarImportedWorld> {
    if (!this.worker) {
      return Promise.resolve(importAzgaarFullJson(document, config, options));
    }
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ id, document, config, options });
    });
  }

  private onMessage(event: MessageEvent): void {
    const { id, world, error } = event.data ?? {};
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    error ? pending.reject(new Error(error)) : pending.resolve(world);
  }

  private onError(event: ErrorEvent): void {
    const error = new Error(event.message || "Azgaar import worker failed.");
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    const error = new Error("Azgaar import worker was disposed.");
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}
