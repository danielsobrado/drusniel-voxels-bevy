import type { RuntimeCommandRequest } from "./runtimeCommands";
import type {
  RuntimeCommandResult,
  RuntimeRenderQualityState,
  RuntimeSnapshot,
} from "./runtimeSchemas";
import type { RuntimeEventHandler } from "./runtimeEvents";
import type { WaterReflectionStatus } from "../types/world";

interface RuntimeBridge {
  readonly executeCommand: (request: RuntimeCommandRequest) => Promise<RuntimeCommandResult<unknown>>;
  readonly getRuntimeSnapshot?: () => Promise<RuntimeCommandResult<RuntimeSnapshot>>;
  readonly getRenderQuality?: () => Promise<RuntimeCommandResult<RuntimeRenderQualityState>>;
  readonly getWaterReflectionStatus?: () => Promise<RuntimeCommandResult<WaterReflectionStatus>>;
  readonly onRuntimeEvent?: (handler: RuntimeEventHandler) => () => void;
}

declare global {
  interface Window {
    drusnielRuntime?: RuntimeBridge;
  }
}

const DEFAULT_LOCAL_BRIDGE_URL = "http://127.0.0.1:17777";
const BRIDGE_MODE_STORAGE_KEY = "drusniel.editor.runtimeBridge";
const BRIDGE_URL_STORAGE_KEY = "drusniel.editor.runtimeBridgeUrl";

const runtimeUnavailable = <T>(message: string): RuntimeCommandResult<T> => ({
  status: "runtime_unavailable",
  ok: false,
  message,
});

const commandFailure = <T>(message: string): RuntimeCommandResult<T> => ({
  status: "failure",
  ok: false,
  message,
});

const commandSuccess = <T>(data: T): RuntimeCommandResult<T> => ({
  status: "success",
  ok: true,
  data,
});

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

const normalizeBridgeResponse = <T>(value: unknown): RuntimeCommandResult<T> => {
  if (!value || typeof value !== "object") {
    return commandFailure("Runtime bridge returned a non-object response.");
  }

  const response = value as RuntimeCommandResult<T> & { readonly requestId?: string };
  void response.requestId;
  return response;
};

const fetchJson = async <T>(url: string, init?: RequestInit): Promise<RuntimeCommandResult<T>> => {
  try {
    const response = await fetch(url, init);
    const body = (await response.json().catch(() => null)) as unknown;
    const result = normalizeBridgeResponse<T>(body);

    if (!response.ok && result.ok) {
      return commandFailure(`Runtime bridge request failed with HTTP ${response.status}.`);
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown bridge request failure.";
    return runtimeUnavailable(`Runtime bridge unavailable: ${message}`);
  }
};

const createLocalHttpRuntimeBridge = (baseUrl: string): RuntimeBridge => {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");

  const getRuntimeSnapshot = async (): Promise<RuntimeCommandResult<RuntimeSnapshot>> =>
    fetchJson<RuntimeSnapshot>(`${normalizedBaseUrl}/runtime/snapshot`);

  return {
    executeCommand: async (request) =>
      fetchJson<unknown>(`${normalizedBaseUrl}/runtime/command`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(request),
      }),
    getRuntimeSnapshot,
    getRenderQuality: async () => {
      const snapshot = await getRuntimeSnapshot();
      return snapshot.ok ? commandSuccess(snapshot.data.renderQuality) : snapshot;
    },
    getWaterReflectionStatus: async () => {
      const snapshot = await getRuntimeSnapshot();
      return snapshot.ok ? commandSuccess(snapshot.data.waterReflection.status) : snapshot;
    },
    onRuntimeEvent: (_handler) => () => undefined,
  };
};

export const installRuntimeBridge = (): void => {
  if (typeof window === "undefined" || window.drusnielRuntime) {
    return;
  }

  const bridgeMode = getConfiguredBridgeMode();
  if (bridgeMode === "local-http") {
    window.drusnielRuntime = createLocalHttpRuntimeBridge(getConfiguredBridgeUrl());
  }
};

installRuntimeBridge();
