import { createContext, useContext, useMemo, type ReactNode } from "react";
import { Toaster } from "sonner";
import { BrowserEditorBackendClient } from "../backend/BrowserEditorBackendClient";
import type { EditorBackendClient } from "../backend/EditorBackendClient";
import type { RuntimeClient } from "../runtime/RuntimeClient";
import { BrowserRuntimeClient, hasBrowserRuntimeBridge, type RuntimeBridge } from "../runtime/BrowserRuntimeClient";
import { createDefaultEditorCameraState } from "../runtime/defaultEditorCamera";
import type { EditorCameraState } from "../runtime/runtimeSchemas";
import { runtimeCommandFailure, runtimeCommandSuccess } from "../runtime/runtimeSchemas";

interface EditorClients {
  readonly backendClient: EditorBackendClient;
  readonly runtimeClient: RuntimeClient;
}

const EditorClientsContext = createContext<EditorClients | null>(null);

const runtimeUnavailableBridge = (): RuntimeBridge => {
  let cameraSequence = 0;
  let editorCamera: EditorCameraState = createDefaultEditorCameraState();
  const unavailable = async () =>
    ({
      status: "runtime_unavailable" as const,
      ok: false as const,
      message: "Desktop editor runtime bridge was not installed.",
      code: "DESKTOP_RUNTIME_BRIDGE_MISSING",
    });

  return {
    executeCommand: async (request) => {
      if (request.type === "runtime.addSavedEditorCamera") {
        cameraSequence += 1;
        const now = new Date().toISOString();
        const camera = {
          id: `camera-${cameraSequence}`,
          name: request.payload.name ?? `Camera ${cameraSequence}`,
          description: request.payload.description,
          cameraKind: editorCamera.cameraKind,
          projection: editorCamera.projection,
          pose: editorCamera.pose,
          alignToAxes: editorCamera.alignToAxes,
          automaticAxis: editorCamera.automaticAxis,
          createdAt: now,
          updatedAt: now,
        };
        editorCamera = {
          ...editorCamera,
          savedCameras: [...editorCamera.savedCameras, camera],
          activeSavedCameraId: camera.id,
        };
        return runtimeCommandSuccess({ camera, editorCamera });
      }
      if (request.type === "runtime.stepSavedEditorCamera") {
        if (editorCamera.savedCameras.length === 0) {
          return runtimeCommandFailure("failure", "No saved cameras exist.", { code: "NO_SAVED_CAMERAS" });
        }
        const currentIndex = Math.max(0, editorCamera.savedCameras.findIndex((camera) => camera.id === editorCamera.activeSavedCameraId));
        const nextIndex = (currentIndex + request.payload.direction + editorCamera.savedCameras.length) % editorCamera.savedCameras.length;
        const camera = editorCamera.savedCameras[nextIndex];
        editorCamera = {
          ...editorCamera,
          cameraKind: camera.cameraKind,
          projection: camera.projection,
          pose: camera.pose,
          alignToAxes: camera.alignToAxes,
          automaticAxis: camera.automaticAxis,
          activeSavedCameraId: camera.id,
        };
        return runtimeCommandSuccess(editorCamera);
      }
      return unavailable();
    },
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

  return new BrowserRuntimeClient(runtimeUnavailableBridge());
};

interface ProvidersProps {
  readonly children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  const clients = useMemo<EditorClients>(
    () => ({
      backendClient: new BrowserEditorBackendClient(),
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
