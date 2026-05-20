export const menuCommandIds = [
  "editor.file.save",
  "editor.file.loadDefaultWorld",
  "editor.history.undo",
  "editor.voxel.replaceSelected",
  "editor.view.resetLayout",
  "editor.world.rebuildSelectedChunk",
  "editor.editTool.open",
  "editor.voxel.paintMaterial",
  "editor.area.createUnbreakableBox",
  "editor.props.scatterOnSelection",
  "editor.material.openTextureAtlas",
  "editor.water.openReflectionDebug",
  "editor.camera.open",
  "editor.lightAtmosphere.open",
  "editor.mode.lighting",
  "editor.agent.observeScreen",
  "editor.mode.debug",
  "editor.palette.open",
  "editor.help.showHandoff",
] as const;

const menuItems = [
  { label: "File", commandId: "editor.file.save" },
  { label: "Load", commandId: "editor.file.loadDefaultWorld" },
  { label: "Edit", commandId: "editor.history.undo" },
  { label: "View", commandId: "editor.view.resetLayout" },
  { label: "World", commandId: "editor.world.rebuildSelectedChunk" },
  { label: "Voxels", commandId: "editor.voxel.paintMaterial" },
  { label: "Areas", commandId: "editor.area.createUnbreakableBox" },
  { label: "Props", commandId: "editor.props.scatterOnSelection" },
  { label: "Materials", commandId: "editor.material.openTextureAtlas" },
  { label: "Water", commandId: "editor.water.openReflectionDebug" },
  { label: "Tools", commandId: "editor.editTool.open" },
  { label: "Atmosphere", commandId: "editor.lightAtmosphere.open" },
  { label: "Lighting", commandId: "editor.mode.lighting" },
  { label: "Agent", commandId: "editor.agent.observeScreen" },
  { label: "Debug", commandId: "editor.mode.debug" },
  { label: "Window", commandId: "editor.palette.open" },
  { label: "Help", commandId: "editor.help.showHandoff" },
] as const;

interface EditorMenubarProps {
  readonly runCommand: (commandId: string) => Promise<void>;
}

export function EditorMenubar({ runCommand }: EditorMenubarProps) {
  return (
    <header className="menubar-root" data-testid="editor-menubar">
      <div className="menubar-inner">
        <div className="menubar-brand">Drusniel World Forge</div>
        <nav className="menubar-nav" role="menubar" aria-label="Editor menu">
          {menuItems.map((item) => (
            <button
              key={item.label}
              type="button"
              className="menubar-button"
              role="menuitem"
              aria-label={`${item.label} menu`}
              data-command-id={item.commandId}
              onClick={() => void runCommand(item.commandId)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <button
          type="button"
          className="menubar-command-button"
          aria-label="Open command palette"
          data-command-id="editor.palette.open"
          onClick={() => void runCommand("editor.palette.open")}
        >
          Commands
        </button>
      </div>
    </header>
  );
}
