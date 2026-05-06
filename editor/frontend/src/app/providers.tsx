import { createContext, useContext, useMemo, type ReactNode } from "react";
import { Toaster } from "sonner";
import { BrowserEditorBackendClient, hasBrowserEditorBackendBridge } from "../backend/BrowserEditorBackendClient";
import type { EditorBackendClient } from "../backend/EditorBackendClient";
import { MockEditorBackendClient } from "../backend/MockEditorBackendClient";
import type { RuntimeClient } from "../runtime/RuntimeClient";
import { BrowserRuntimeClient, hasBrowserRuntimeBridge } from "../runtime/BrowserRuntimeClient";
import { MockRuntimeClient } from "../runtime/MockRuntimeClient";

interface EditorClients {
  readonly backendClient: EditorBackendClient;
  readonly runtimeClient: RuntimeClient;
}

const EditorClientsContext = createContext<EditorClients | null>(null);

interface ProvidersProps {
  readonly children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  const clients = useMemo<EditorClients>(
    () => ({
      backendClient: hasBrowserEditorBackendBridge() ? new BrowserEditorBackendClient() : new MockEditorBackendClient(),
      runtimeClient: hasBrowserRuntimeBridge() ? new BrowserRuntimeClient() : new MockRuntimeClient(),
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
