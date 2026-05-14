import type { AtlasMappingDto, BackendResult, EditorBackendClient, VoxelModelExport, VoxelModelFormat, WorldSaveSummary, WorldSummary } from "./EditorBackendClient";
import type { RuntimeCommandRequest } from "../runtime/runtimeCommands";
import type { RuntimeCommandResult, RuntimeSaveSummary, RuntimeSnapshot } from "../runtime/runtimeSchemas";
import type { ViewportSnapshot } from "../types/world";

const DEFAULT_LOCAL_BRIDGE_URL = "http://127.0.0.1:17777";
const BRIDGE_MODE_STORAGE_KEY = "drusniel.editor.runtimeBridge";
const BRIDGE_URL_STORAGE_KEY = "drusniel.editor.runtimeBridgeUrl";

const readLocalStorage = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const getQueryBridgeMode = (): string | null => {
  try {
    return new URLSearchParams(window.location.search).get("runtimeBridge");
  } catch {
    return null;
  }
};

const getConfiguredBridgeMode = (): string | undefined =>
  import.meta.env.VITE_DRUSNIEL_RUNTIME_BRIDGE ?? getQueryBridgeMode() ?? readLocalStorage(BRIDGE_MODE_STORAGE_KEY) ?? undefined;

const getConfiguredBridgeUrl = (): string =>
  import.meta.env.VITE_DRUSNIEL_RUNTIME_BRIDGE_URL ??
  readLocalStorage(BRIDGE_URL_STORAGE_KEY) ??
  DEFAULT_LOCAL_BRIDGE_URL;

export const isTauriDesktop = (): boolean =>
  typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

export const hasBrowserEditorBackendBridge = (): boolean =>
  typeof window !== "undefined" && (isTauriDesktop() || getConfiguredBridgeMode() === "local-http");

const normalizeBackendResult = async <T>(response: Response): Promise<BackendResult<T>> => {
  const body = (await response.json().catch(() => null)) as BackendResult<T> | null;

  if (!body || typeof body !== "object") {
    return { ok: false, error: `Editor backend returned invalid JSON with HTTP ${response.status}.`, code: "INVALID_BACKEND_RESPONSE" };
  }

  if (!response.ok && body.ok) {
    return { ok: false, error: `Editor backend request failed with HTTP ${response.status}.`, code: "HTTP_ERROR" };
  }

  return body;
};

const normalizeRuntimeResult = async <T>(response: Response): Promise<BackendResult<T>> => {
  const body = (await response.json().catch(() => null)) as RuntimeCommandResult<T> | null;

  if (!body || typeof body !== "object") {
    return { ok: false, error: `Runtime bridge returned invalid JSON with HTTP ${response.status}.`, code: "INVALID_RUNTIME_RESPONSE" };
  }

  if (!response.ok && body.ok) {
    return { ok: false, error: `Runtime bridge request failed with HTTP ${response.status}.`, code: "HTTP_ERROR" };
  }

  return body.ok ? { ok: true, data: body.data } : { ok: false, error: body.message, code: body.code ?? body.status };
};

const makeRequestId = (type: string): string =>
  `${type}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export class BrowserEditorBackendClient implements EditorBackendClient {
  private readonly baseUrl: string;

  constructor(baseUrl = getConfiguredBridgeUrl()) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async saveWorldSnapshot(): Promise<BackendResult<WorldSaveSummary>> {
    return this.saveDefaultWorld();
  }

  async loadDefaultWorld(): Promise<BackendResult<WorldSummary>> {
    return this.fetchJson<WorldSummary>("/editor/world/load-default", { method: "POST" });
  }

  async loadWorldFile(file: File): Promise<BackendResult<WorldSummary>> {
    try {
      const extension = file.name.split(".").pop()?.toLowerCase();
      const path = extension === "vox" || extension === "vl32"
        ? `/editor/model/import/${extension}`
        : "/editor/world/load-upload";

      return await this.fetchJson<WorldSummary>(path, {
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
        },
        body: await file.arrayBuffer(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown file read failure.";
      return { ok: false, error: `Failed to read selected file: ${message}`, code: "WORLD_FILE_READ_FAILED" };
    }
  }

  async exportVoxelModel(format: VoxelModelFormat): Promise<BackendResult<VoxelModelExport>> {
    const result = await this.fetchBlob(`/editor/model/export/${format}`);
    if (!result.ok) {
      return result;
    }

    return {
      ok: true,
      data: {
        fileName: `drusniel-world.${format}`,
        contentType: result.data.type || (format === "vox" ? "model/x-vox" : "model/x-vl32"),
        blob: result.data,
      },
    };
  }

  async saveDefaultWorld(): Promise<BackendResult<WorldSaveSummary>> {
    return this.fetchJson<WorldSaveSummary>("/editor/world/save-default", { method: "POST" });
  }

  async savedWorldExists(): Promise<BackendResult<boolean>> {
    const summary = await this.getWorldSummary();
    return summary.ok ? { ok: true, data: true } : { ok: true, data: false };
  }

  async deleteSavedWorld(): Promise<BackendResult<{ readonly deleted: boolean }>> {
    return { ok: false, error: "Deleting saved worlds is not exposed by the local HTTP editor backend.", code: "UNSUPPORTED" };
  }

  async getWorldSummary(): Promise<BackendResult<WorldSummary>> {
    return this.fetchJson<WorldSummary>("/editor/world/summary");
  }

  async getViewportSnapshot(): Promise<BackendResult<ViewportSnapshot>> {
    return this.fetchJson<ViewportSnapshot>("/editor/viewport/snapshot");
  }

  async getChunkSummaries(): Promise<BackendResult<WorldSummary["chunks"]>> {
    const summary = await this.getWorldSummary();
    return summary.ok ? { ok: true, data: summary.data.chunks } : summary;
  }

  async loadAtlasMapping(): Promise<BackendResult<AtlasMappingDto>> {
    const snapshot = await this.fetchRuntimeJson<RuntimeSnapshot>("/runtime/snapshot");
    return snapshot.ok ? { ok: true, data: snapshot.data.atlasMapping.mapping } : snapshot;
  }

  async saveAtlasMapping(atlasMapping: AtlasMappingDto): Promise<BackendResult<WorldSaveSummary>> {
    const request: RuntimeCommandRequest = {
      type: "runtime.saveAtlasMapping",
      requestId: makeRequestId("runtime.saveAtlasMapping"),
      payload: { mapping: atlasMapping },
    };
    const result = await this.fetchRuntimeJson<RuntimeSaveSummary>("/runtime/command", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
    });

    return result.ok ? { ok: true, data: result.data } : result;
  }

  private async fetchJson<T>(path: string, init?: RequestInit): Promise<BackendResult<T>> {
    try {
      return await normalizeBackendResult<T>(await fetch(`${this.baseUrl}${path}`, init));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown editor backend request failure.";
      return { ok: false, error: `Editor backend unavailable: ${message}`, code: "BACKEND_UNAVAILABLE" };
    }
  }

  private async fetchBlob(path: string, init?: RequestInit): Promise<BackendResult<Blob>> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, init);
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as BackendResult<unknown> | null;
        return {
          ok: false,
          error: body && !body.ok ? body.error : `Editor backend request failed with HTTP ${response.status}.`,
          code: body && !body.ok ? body.code : "HTTP_ERROR",
        };
      }

      return { ok: true, data: await response.blob() };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown editor backend request failure.";
      return { ok: false, error: `Editor backend unavailable: ${message}`, code: "BACKEND_UNAVAILABLE" };
    }
  }

  private async fetchRuntimeJson<T>(path: string, init?: RequestInit): Promise<BackendResult<T>> {
    try {
      return await normalizeRuntimeResult<T>(await fetch(`${this.baseUrl}${path}`, init));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown runtime bridge request failure.";
      return { ok: false, error: `Runtime bridge unavailable: ${message}`, code: "RUNTIME_BRIDGE_UNAVAILABLE" };
    }
  }
}
