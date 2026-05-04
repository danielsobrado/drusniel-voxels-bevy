import { Command } from "cmdk";
import { editorCommands } from "../../commands/commandRegistry";

interface CommandPaletteProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly runCommand: (id: string) => Promise<void>;
}

export function CommandPalette({ open, onOpenChange, runCommand }: CommandPaletteProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="command-palette-backdrop" role="presentation" onMouseDown={() => onOpenChange(false)}>
      <Command
        className="command-palette"
        data-testid="command-palette"
        label="Editor command palette"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <Command.Input className="command-palette-input" autoFocus placeholder="Run editor command..." />
        <Command.List className="command-palette-list">
          <Command.Empty className="command-palette-empty">No commands found.</Command.Empty>
          {editorCommands.map((command) => (
            <Command.Item
              key={command.id}
              className="command-palette-item"
              data-command-id={command.id}
              value={[command.id, command.title, command.description, command.category, ...(command.keywords ?? [])].join(" ")}
              onSelect={() => {
                void runCommand(command.id).then(() => onOpenChange(false));
              }}
            >
              <span>
                <strong>{command.title}</strong>
                <small>{command.description}</small>
              </span>
              <span className="command-palette-meta">
                <small>{command.category}</small>
                {command.shortcut ? <kbd>{command.shortcut}</kbd> : null}
                <code>{command.id}</code>
              </span>
            </Command.Item>
          ))}
        </Command.List>
      </Command>
    </div>
  );
}
