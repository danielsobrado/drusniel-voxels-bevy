import { createContext, useContext, useMemo, type ReactNode } from "react";
import { Toaster } from "sonner";
import { BrowserEditorBackendClient, hasBrowserEditorBackendBridge, isTauriDesktop } from "../backend/BrowserEditorBackendClient";
import type { EditorBackendClient } from "../backend/EditorBackendClient";
import { MockEditorBackendClient } from "../backend/MockEditorBackendClient";
import type { RuntimeClient } from "../runtime/RuntimeClient";
import { BrowserRuntimeClient, hasBrowserRuntimeBridge, type RuntimeBridge } from "../runtime/BrowserRuntimeClient";
import { MockRuntimeClient } from "../runtime/MockRuntimeClient";

interface EditorClients {
  readonly backendClient: EditorBackendClient;
  readonly runtimeClient: RuntimeClient;
}

const EditorClientsContext = createContext<EditorClients | null>(null);

const runtimeUnavailableBridge = (): RuntimeBridge => {
  const unavailable = async () =>
    ({
      status: "runtime_unavailable" as const,
      ok: false as const,
      message: "Desktop editor runtime bridge was not installed.",
      code: "DESKTOP_RUNTIME_BRIDGE_MISSING",
    });

  return {
    executeCommand: unavailable,
    getRuntimeSnapshot: unavailable,
    getRenderQuality: unavailable,
    getWaterReflectionStatus: unavailable,
    onRuntimeEvent: () => () => undefined,
  };
};

const createRuntimeClient = (): RuntimeClient => {
  if (hasBrowserRuntimeBridge()) {
    return new BrowserRuntimeClient();
  }

  return isTauriDesktop() ? new BrowserRuntimeClient(runtimeUnavailableBridge()) : new MockRuntimeClient();
};

interface ProvidersProps {
  readonly children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  const clients = useMemo<EditorClients>(
    () => ({
      backendClient: hasBrowserEditorBackendBridge() ? new BrowserEditorBackendClient() : new MockEditorBackendClient(),
      runtimeClient: createRuntimeClient(),
    }),
    [],
  );

  return (
    <EditorClientsContext.Provider value={clients}>
      {children}
      <Toaster richColors position="bottom-right" />
    </EditorClientsContext.Provider>
  );
}

export function useEditorClients() {
  const clients = useContext(EditorClientsContext);

  if (!clients) {
    throw new Error("useEditorClients must be used inside Providers.");
  }

  return clients;
}
