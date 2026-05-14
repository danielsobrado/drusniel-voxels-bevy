import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useEditorClients } from "./providers";
import { CommandPalette } from "../components/editor/CommandPalette";
import { DockLayout } from "../components/editor/DockLayout";
import { EditorMenubar } from "../components/editor/EditorMenubar";
import { MainToolbar } from "../components/editor/MainToolbar";
import { useCommandRunner } from "../commands/useCommandRunner";
import { useEditorStore } from "../state/editorStore";
import type { RuntimeSnapshot } from "../runtime/runtimeSchemas";

const selectionKey = (selection: RuntimeSnapshot["selection"]): string =>
  selection === null
    ? "none"
    : selection.kind === "voxel"
      ? `voxel:${selection.chunkId}:${selection.position.join(",")}`
      : `${selection.kind}:${selection.id}`;

const applyRuntimeSnapshot = (snapshot: RuntimeSnapshot): void => {
  const currentSelection = useEditorStore.getState().selection;
  const nextSelection = snapshot.selection;

  useEditorStore.setState((state) => ({
    runtimeState: snapshot.connectionState,
    runtimeMetrics: snapshot.metrics,
    renderQualityPreset: snapshot.renderQuality.preset,
    waterRuntimeSnapshot: snapshot.waterVisualProbe,
    atlasMapping: snapshot.atlasMapping.mapping,
    viewportOverlays: snapshot.viewportDebug,
    dirtyState: {
      ...state.dirtyState,
      dirtyAtlas: snapshot.atlasMapping.dirty,
      hasUnsavedChanges:
        state.dirtyState.dirtyChunkIds.length > 0 ||
        state.dirtyState.dirtyAreaIds.length > 0 ||
        state.dirtyState.dirtyWaterBodyIds.length > 0 ||
        state.dirtyState.dirtyPropIds.length > 0 ||
        snapshot.atlasMapping.dirty ||
        state.dirtyState.layoutDirty,
    },
    selection:
      nextSelection && selectionKey(nextSelection) !== selectionKey(currentSelection)
        ? nextSelection
        : state.selection,
  }));
};

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
  const lastRuntimeSnapshotErrorRef = useRef(0);

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

  const isEditableKeyboardTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
  };

  useEffect(() => {
    if (didLoadWorldSummaryRef.current) {
      return;
    }

    didLoadWorldSummaryRef.current = true;
    void runCommandById("editor.file.loadDefaultWorld");
  }, [runCommandById]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | undefined;

    const pollRuntimeSnapshot = async () => {
      const result = await runtimeClient.getRuntimeSnapshot();
      if (cancelled) {
        return;
      }

      if (!result.ok) {
        useEditorStore.getState().setRuntimeState(result.status === "runtime_unavailable" ? "disconnected" : "error");
        const now = Date.now();
        if (now - lastRuntimeSnapshotErrorRef.current > 10_000) {
          lastRuntimeSnapshotErrorRef.current = now;
          useEditorStore.setState((state) => ({
            consoleMessages: [
              {
                id: `console-runtime-snapshot-${now}`,
                level: "error",
                message: `runtime.snapshot: ${result.message}`,
                time: new Date().toLocaleTimeString(),
              },
              ...state.consoleMessages,
            ],
          }));
        }
      } else {
        applyRuntimeSnapshot(result.data);
      }

      timeoutId = window.setTimeout(pollRuntimeSnapshot, 750);
    };

    void pollRuntimeSnapshot();

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [runtimeClient]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        !isEditableKeyboardTarget(event.target) &&
        (event.key === "Delete" || event.key === "Backspace") &&
        useEditorStore.getState().selection.kind === "prop"
      ) {
        event.preventDefault();
        void runCommandById("editor.props.clearInSelection");
        return;
      }

      if (!(event.ctrlKey || event.metaKey) || event.altKey) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "k") {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }

      if (key === "o") {
        event.preventDefault();
        void runCommandById("editor.file.openWorld");
        return;
      }

      if (key === "s") {
        event.preventDefault();
        void runCommandById("editor.file.save");
        return;
      }

      if (key === "z" && !isEditableKeyboardTarget(event.target)) {
        event.preventDefault();
        void runCommandById(event.shiftKey ? "editor.history.redo" : "editor.history.undo");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [runCommandById]);

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
        aria-label="Open Drusniel world or voxel model file"
        className="sr-only"
        type="file"
        accept=".bin,.world,.vox,.vl32"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) {
            return;
          }

          void backendClient.loadWorldFile(file).then((result) => {
            if (!result.ok) {
              toast.error(`Failed to load world file: ${result.error}`);
              return;
            }

            useEditorStore.getState().replaceWorldSummary(result.data);
            void backendClient.getViewportSnapshot().then((snapshot) => {
              if (snapshot.ok) {
                useEditorStore.getState().setViewportSnapshot(snapshot.data);
              }
            });
            useEditorStore.getState().setRuntimeState("connected");
            toast.success(`Loaded world file: ${result.data.name}.`);
          });
          event.target.value = "";
        }}
      />
    </div>
  );
}
