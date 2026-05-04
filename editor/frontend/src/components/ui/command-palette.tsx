import * as React from "react";
import { Command } from "cmdk";
import { X } from "lucide-react";
import { Separator } from "./separator";

type PaletteCommand = {
  id: string;
  title: string;
  shortcut?: string;
  onSelect: () => void;
};

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenWorld: () => void;
  commands?: PaletteCommand[];
}

export function CommandPalette({
  open,
  onOpenChange,
  onOpenWorld,
  commands,
}: CommandPaletteProps) {
  const [query, setQuery] = React.useState("");
  const rows = (commands && commands.length > 0 ? commands : []).concat([
    {
      id: "open-world",
      title: "Open World File",
      onSelect: onOpenWorld,
      shortcut: "Cmd/Ctrl+K",
    },
  ]);
  const uniqueRows = rows.filter(
    (command, index, list) => list.findIndex((item) => item.id === command.id) === index,
  );

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Editor Command Palette"
      className="fixed inset-0 z-[9999] bg-black/40"
    >
      <div className="fixed inset-x-0 top-20 mx-auto w-full max-w-2xl">
        <div className="rounded-lg border border-editor-border bg-editor-panel2 shadow-panel">
          <div className="border-b border-editor-border p-2 flex items-center gap-2">
            <Command.Input
              value={query}
              onValueChange={setQuery}
              className="h-9 w-full rounded-md border border-editor-border bg-editor-bg-canvas px-3 text-sm text-editor-fg outline-none"
              placeholder="Search command..."
            />
            <button
              onClick={() => onOpenChange(false)}
              className="h-8 w-8 rounded-md text-editor-fg-3 hover:bg-editor-bg-canvas"
              aria-label="Close command palette"
              type="button"
            >
              <X size={16} />
            </button>
          </div>
          <Command.List className="max-h-72 overflow-auto p-1">
            <Command.Empty className="px-3 py-8 text-center text-xs text-editor-fg-3">
              No command found.
            </Command.Empty>
            <Command.Group>
              {uniqueRows
                .filter((command) =>
                  command.title.toLowerCase().includes(query.toLowerCase()),
                )
                .map((command) => (
                  <Command.Item
                    key={command.id}
                    onSelect={() => {
                      command.onSelect();
                      onOpenChange(false);
                    }}
                    value={command.title}
                    className="rounded-sm px-2 py-2 text-xs text-editor-fg cursor-default data-[selected=true]:bg-editor-cyan/20"
                  >
                    <span>{command.title}</span>
                    <Separator className="ml-auto w-16" />
                    {command.shortcut ? (
                      <span className="ml-auto text-editor-fg-3 text-[10px]">
                        {command.shortcut}
                      </span>
                    ) : null}
                  </Command.Item>
                ))}
            </Command.Group>
          </Command.List>
        </div>
      </div>
    </Command.Dialog>
  );
}
