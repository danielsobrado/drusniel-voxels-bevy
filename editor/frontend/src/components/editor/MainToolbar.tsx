import { Brush, Boxes, Droplets, Grid3X3, History, Lightbulb, MousePointer2, Package, Redo2, Save, Sparkles, SquareDashedMousePointer, TestTube2, Undo2 } from "lucide-react";
import { useEditorStore } from "../../state/editorStore";
import type { EditorMode, RenderQualityPreset } from "../../types/editor";
import { StatusPill } from "./StatusPill";

export const modeCommandIds = ["editor.mode.select", "editor.mode.voxelSculpt", "editor.mode.voxelPaint", "editor.mode.area", "editor.mode.props", "editor.mode.water", "editor.mode.lighting", "editor.mode.agent"] as const;
export const toolbarCommandIds = [
  "editor.file.save",
  "editor.file.saveSnapshot",
  "editor.history.undo",
  "editor.history.redo",
  "editor.view.toggleVoxelGrid",
  "editor.view.toggleChunkBounds",
  "editor.view.toggleWireframe",
  ...modeCommandIds,
] as const;

const modeButtons: readonly { mode: EditorMode; label: string; commandId: string; icon: typeof MousePointer2 }[] = [
  { mode: "select", label: "Select", commandId: "editor.mode.select", icon: MousePointer2 },
  { mode: "voxel_sculpt", label: "Sculpt", commandId: "editor.mode.voxelSculpt", icon: Brush },
  { mode: "voxel_paint", label: "Paint", commandId: "editor.mode.voxelPaint", icon: SquareDashedMousePointer },
  { mode: "area", label: "Areas", commandId: "editor.mode.area", icon: TestTube2 },
  { mode: "props", label: "Props", commandId: "editor.mode.props", icon: Package },
  { mode: "water", label: "Water", commandId: "editor.mode.water", icon: Droplets },
  { mode: "lighting", label: "Lighting", commandId: "editor.mode.lighting", icon: Lightbulb },
  { mode: "agent", label: "Agent", commandId: "editor.mode.agent", icon: Sparkles },
];

interface MainToolbarProps {
  readonly runCommand: (commandId: string) => Promise<void>;
}

export function MainToolbar({ runCommand }: MainToolbarProps) {
  const activeMode = useEditorStore((state) => state.activeMode);
  const brushSettings = useEditorStore((state) => state.brushSettings);
  const renderQualityPreset = useEditorStore((state) => state.renderQualityPreset);
  const runtimeState = useEditorStore((state) => state.runtimeState);
  const dirtyState = useEditorStore((state) => state.dirtyState);
  const pendingCommandIds = useEditorStore((state) => state.pendingCommandIds);
  const undoCount = useEditorStore((state) => state.undoStack.length);
  const redoCount = useEditorStore((state) => state.redoStack.length);
  const setBrushRadius = useEditorStore((state) => state.setBrushRadius);
  const qualityPending = pendingCommandIds.some((commandId) => commandId.startsWith("editor.rendering.setQuality") || commandId.startsWith("editor.quality."));

  return (
    <section className="toolbar-root" data-testid="main-toolbar" aria-label="Main editor toolbar">
      <div className="toolbar-group" aria-label="File controls">
          <button type="button" className="toolbar-button" aria-label="Save editor" data-command-id="editor.file.save" onClick={() => void runCommand("editor.file.save")}>
            <Save size={14} aria-hidden="true" /> Save
          </button>
          
          <button type="button" className="toolbar-button" aria-label="Save editor snapshot" data-command-id="editor.file.saveSnapshot" onClick={() => void runCommand("editor.file.saveSnapshot")}>
            <History size={14} aria-hidden="true" /> Snapshot
          </button>
        </div>
        <div className="toolbar-group" aria-label="History controls">
          <button type="button" className="toolbar-button" aria-label="Undo last editor command" data-command-id="editor.history.undo" disabled={undoCount === 0} onClick={() => void runCommand("editor.history.undo")}>
            <Undo2 size={14} aria-hidden="true" /> Undo
          </button>
          <button type="button" className="toolbar-button" aria-label="Redo editor command" data-command-id="editor.history.redo" disabled={redoCount === 0} onClick={() => void runCommand("editor.history.redo")}>
            <Redo2 size={14} aria-hidden="true" /> Redo
          </button>
        </div>
        <div className="toolbar-group" aria-label="Viewport overlay controls">
          <button type="button" className="toolbar-button" aria-label="Toggle voxel grid" data-command-id="editor.view.toggleVoxelGrid" onClick={() => void runCommand("editor.view.toggleVoxelGrid")}>
            <Grid3X3 size={14} aria-hidden="true" /> Voxel Grid
          </button>
        <button type="button" className="toolbar-button" aria-label="Toggle chunk bounds" data-command-id="editor.view.toggleChunkBounds" onClick={() => void runCommand("editor.view.toggleChunkBounds")}>
          <Boxes size={14} aria-hidden="true" /> Chunk Bounds
        </button>
        <button type="button" className="toolbar-button" aria-label="Toggle wireframe" data-command-id="editor.view.toggleWireframe" onClick={() => void runCommand("editor.view.toggleWireframe")}>
          <SquareDashedMousePointer size={14} aria-hidden="true" /> Wireframe
        </button>
      </div>
      <div className="toolbar-group toolbar-modes" aria-label="Editor modes">
        {modeButtons.map(({ mode, label, commandId, icon: Icon }) => (
          <button key={mode} type="button" className={activeMode === mode ? "toolbar-button toolbar-button-active" : "toolbar-button"} aria-label={`Switch to ${label} mode`} aria-pressed={activeMode === mode} data-command-id={commandId} onClick={() => void runCommand(commandId)}>
            <Icon size={14} aria-hidden="true" /> {label}
          </button>
        ))}
      </div>
      <label className="toolbar-field">
        Brush radius
        <input aria-label="Brush radius" min={1} max={16} type="range" value={brushSettings.radius} onChange={(event) => setBrushRadius(Number(event.target.value))} />
        <span>{brushSettings.radius}</span>
      </label>
      <label className="toolbar-field">
        Quality preset
        <select
          aria-label="Render quality preset"
          value={renderQualityPreset}
          disabled={qualityPending}
          onChange={(event) => void runCommand(`editor.rendering.setQuality${event.target.value as RenderQualityPreset}`)}
        >
          <option value="Low">Low</option>
          <option value="Medium">Medium</option>
          <option value="High">High</option>
          <option value="Performance100">Performance100</option>
        </select>
      </label>
      <div className="toolbar-status" aria-label="Runtime status">
        <StatusPill tone={runtimeState === "connected" || runtimeState === "mock" ? "ok" : runtimeState === "stale" || runtimeState === "error" ? "warn" : "neutral"}>
          {runtimeState.toUpperCase()}
        </StatusPill>
        <span data-testid="dirty-state-label">
          <StatusPill tone={dirtyState.hasUnsavedChanges ? "warn" : "ok"}>{dirtyState.hasUnsavedChanges ? "DIRTY" : "SAVED"}</StatusPill>
        </span>
        <StatusPill tone="agent">AGENT READY</StatusPill>
      </div>
    </section>
  );
}
