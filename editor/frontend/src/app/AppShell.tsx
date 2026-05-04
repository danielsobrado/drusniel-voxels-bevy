import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
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
  const selection = useEditorStore((state) => state.selection);
  const chunkBoundsEnabled = useEditorStore((state) => state.viewportOverlays.chunkBounds);

  const openWorldFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const { runCommandById } = useCommandRunner({
    openCommandPalette: () => setPaletteOpen(true),
    openWorldFile,
  });

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
      <div className="sr-only" data-testid="command-history-latest-id">{commandHistory[0]?.commandId ?? "none"}</div>
      <div className="sr-only" data-testid="protected-area-count">{protectedAreaCount}</div>
      <div className="sr-only" data-testid="current-selection-label">{selection.label}</div>
      <div className="sr-only" data-testid="chunk-bounds-state">{chunkBoundsEnabled ? "on" : "off"}</div>
      <DockLayout resetRequestId={layoutResetRequestId} />
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

          toast.info(`World file picker received ${file.name}; parsing is deferred.`);
          event.target.value = "";
        }}
      />
    </div>
  );
}
