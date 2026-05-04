import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { summarizeWorldFileText } from "../domain/worldFile";
import { useEditorClients } from "./providers";
import { CommandPalette } from "../components/editor/CommandPalette";
import { DockLayout } from "../components/editor/DockLayout";
import { EditorMenubar } from "../components/editor/EditorMenubar";
import { MainToolbar } from "../components/editor/MainToolbar";
import { useCommandRunner } from "../commands/useCommandRunner";
import { useEditorStore } from "../state/editorStore";

export function AppShell() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const layoutResetRequestId = useEditorStore((state) => state.layoutResetRequestId);
  const commandHistory = useEditorStore((state) => state.commandHistory);
  const protectedAreaCount = useEditorStore((state) => state.protectedAreas.length);
  const activeMode = useEditorStore((state) => state.activeMode);
  const activeTool = useEditorStore((state) => state.activeTool);
  const runtimeState = useEditorStore((state) => state.runtimeState);
  const selection = useEditorStore((state) => state.selection);
  const chunkBoundsEnabled = useEditorStore((state) => state.viewportOverlays.chunkBounds);
  const { backendClient, runtimeClient } = useEditorClients();

  const openWorldFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);
  const openCommandPalette = useCallback(() => setPaletteOpen(true), []);
  const didLoadWorldSummaryRef = useRef(false);

  const { runCommandById } = useCommandRunner({
    backendClient,
    runtimeClient,
    openCommandPalette,
    openWorldFile,
  });

  useEffect(() => {
    if (didLoadWorldSummaryRef.current) {
      return;
    }

    didLoadWorldSummaryRef.current = true;
    void runCommandById("editor.file.loadDefaultWorld");
  }, [runCommandById]);

  useEffect(() => {
    void runtimeClient.getRuntimeSnapshot().then((result) => {
      if (!result.ok) {
        useEditorStore.getState().setRuntimeState(result.status === "runtime_unavailable" ? "disconnected" : "error");
        useEditorStore.setState((state) => ({
          consoleMessages: [
            {
              id: `console-runtime-snapshot-${Date.now()}`,
              level: "error",
              message: `runtime.snapshot: ${result.message}`,
              time: new Date().toLocaleTimeString(),
            },
            ...state.consoleMessages,
          ],
        }));
        return;
      }

      useEditorStore.setState({
        runtimeState: result.data.connectionState,
        runtimeMetrics: result.data.metrics,
        renderQualityPreset: result.data.renderQuality.preset,
        waterRuntimeSnapshot: result.data.waterVisualProbe,
      });
    });
  }, [runtimeClient]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="app-shell bg-noise" data-testid="app-shell">
      <EditorMenubar runCommand={runCommandById} />
      <MainToolbar runCommand={runCommandById} />
      <div className="sr-only" data-testid="command-history-latest-id">
        {commandHistory[0]?.commandId ?? "none"}
      </div>
      <div className="sr-only" data-testid="protected-area-count">
        {protectedAreaCount}
      </div>
      <div className="sr-only" data-testid="current-selection-label">
        {selection.label}
      </div>
      <div className="sr-only" data-testid="chunk-bounds-state">
        {chunkBoundsEnabled ? "on" : "off"}
      </div>
      <div className="sr-only" data-testid="current-mode">
        {activeMode}
      </div>
      <div className="sr-only" data-testid="current-tool">
        {activeTool}
      </div>
      <div className="sr-only" data-testid="runtime-connection-state">
        {runtimeState}
      </div>
      <DockLayout resetRequestId={layoutResetRequestId} runCommand={runCommandById} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} runCommand={runCommandById} />
      <input
        ref={fileInputRef}
        aria-label="Open Drusniel world file"
        className="sr-only"
        type="file"
        accept=".ron,.json,.world"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) {
            return;
          }

          void file
            .text()
            .then((text) => {
              const summary = summarizeWorldFileText({ fileName: file.name, text });
              toast.info(`World file parser preview: ${summary.name} (${summary.payloadType}, ${summary.entityCount} entities).`);
            })
            .catch(() => {
              toast.warning("Failed to parse world file preview.");
            });
          event.target.value = "";
        }}
      />
    </div>
  );
}
