import { mockAtlasMapping } from "../mocks/mockWorld";
import type { AtlasMappingDto, BackendResult, EditorBackendClient, WorldSaveSummary, WorldSummary } from "./EditorBackendClient";

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

const isTauriDesktop = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

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
      return await this.fetchJson<WorldSummary>("/editor/world/load-upload", {
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
        },
        body: await file.arrayBuffer(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown world file read failure.";
      return { ok: false, error: `Failed to read selected world file: ${message}`, code: "WORLD_FILE_READ_FAILED" };
    }
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

  async getChunkSummaries(): Promise<BackendResult<WorldSummary["chunks"]>> {
    const summary = await this.getWorldSummary();
    return summary.ok ? { ok: true, data: summary.data.chunks } : summary;
  }

  async loadAtlasMapping(): Promise<BackendResult<AtlasMappingDto>> {
    return { ok: true, data: mockAtlasMapping };
  }

  async saveAtlasMapping(_atlasMapping: AtlasMappingDto): Promise<BackendResult<WorldSaveSummary>> {
    return this.saveDefaultWorld();
  }

  private async fetchJson<T>(path: string, init?: RequestInit): Promise<BackendResult<T>> {
    try {
      return await normalizeBackendResult<T>(await fetch(`${this.baseUrl}${path}`, init));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown editor backend request failure.";
      return { ok: false, error: `Editor backend unavailable: ${message}`, code: "BACKEND_UNAVAILABLE" };
    }
  }
}
