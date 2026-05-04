import { Brush, Boxes, Droplets, Grid3X3, Lightbulb, MousePointer2, Package, Save, Sparkles, SquareDashedMousePointer, TestTube2 } from "lucide-react";
import { useEditorStore } from "../../state/editorStore";
import type { EditorMode, RenderQualityPreset } from "../../types/editor";
import { StatusPill } from "./StatusPill";

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
  const setBrushRadius = useEditorStore((state) => state.setBrushRadius);

  return (
    <section className="toolbar-root" data-testid="main-toolbar" aria-label="Main editor toolbar">
      <div className="toolbar-group" aria-label="File controls">
        <button type="button" className="toolbar-button" aria-label="Save editor" data-command-id="editor.file.save" onClick={() => void runCommand("editor.file.save")}>
          <Save size={14} aria-hidden="true" /> Save
        </button>
        <button type="button" className="toolbar-button" aria-label="Save editor snapshot" data-command-id="editor.file.saveSnapshot" onClick={() => void runCommand("editor.file.saveSnapshot")}>
          Snapshot
        </button>
      </div>
      <div className="toolbar-group" aria-label="Viewport overlay controls">
        <button type="button" className="toolbar-button" aria-label="Toggle voxel grid" data-command-id="editor.view.toggleVoxelGrid" onClick={() => void runCommand("editor.view.toggleVoxelGrid")}>
          <Grid3X3 size={14} aria-hidden="true" /> Voxel Grid
        </button>
        <button type="button" className="toolbar-button" aria-label="Toggle chunk bounds" data-command-id="editor.view.toggleChunkBounds" onClick={() => void runCommand("editor.view.toggleChunkBounds")}>
          <Boxes size={14} aria-hidden="true" /> Chunk Bounds
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
        <select aria-label="Render quality preset" value={renderQualityPreset} onChange={(event) => void runCommand(`editor.quality.${event.target.value as RenderQualityPreset}`)}>
          <option value="Low">Low</option>
          <option value="Medium">Medium</option>
          <option value="High">High</option>
          <option value="Performance100">Performance100</option>
        </select>
      </label>
      <div className="toolbar-status" aria-label="Runtime status">
        <StatusPill tone={runtimeState === "playing" || runtimeState === "simulating" ? "ok" : "neutral"}>{runtimeState.toUpperCase()}</StatusPill>
        <StatusPill tone={dirtyState.hasUnsavedChanges ? "warn" : "ok"}>{dirtyState.hasUnsavedChanges ? "DIRTY" : "SAVED"}</StatusPill>
        <StatusPill tone="agent">AGENT READY</StatusPill>
      </div>
    </section>
  );
}
