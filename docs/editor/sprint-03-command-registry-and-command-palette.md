# Sprint 3 � Command registry and command palette

Document status (2026-05-17): planning record; use for rationale and sequencing, not as current execution instructions unless reconciled with code first.

Phase: 1 � Editor Shell MVP

## Goal
Make the editor operable through menus, buttons, keyboard, and LLM agents using the same command system.

## Subtasks
- Create `commands/commandTypes.ts`.
- Create `commands/commandRegistry.ts`.
- Implement command shape:

```ts
type EditorCommand = {
  id: string;
  title: string;
  description: string;
  category: string;
  shortcut?: string;
  keywords?: string[];
  run: (ctx: EditorCommandContext) => Promise<void> | void;
};
```

- Add core commands:
  - `editor.file.save`
  - `editor.file.saveSnapshot`
  - `editor.view.toggleVoxelGrid`
  - `editor.view.toggleChunkBounds`
  - `editor.view.toggleProtectedAreas`
  - `editor.view.togglePropBounds`
  - `editor.mode.select`
  - `editor.mode.voxelSculpt`
  - `editor.mode.voxelPaint`
  - `editor.mode.area`
  - `editor.mode.props`
  - `editor.mode.water`
  - `editor.area.createUnbreakableBox`
  - `editor.area.createNoBuildZone`
  - `editor.area.createNoDigZone`
  - `editor.water.openReflectionDebug`
  - `editor.water.runVisualProbe`
  - `editor.world.rebuildSelectedChunk`
  - `editor.world.rebuildDirtyChunks`
  - `editor.agent.observeScreen`
  - `editor.agent.runPlan`
  - `editor.agent.generatePlaywrightTest`
- Build CommandPalette using `cmdk`.
- Wire menus and toolbar buttons to command IDs.
- Add command history to the store.
- Add toast output for mocked actions.

## Acceptance criteria
- `Ctrl/Cmd + K` opens the command palette.
- Searching `unbreakable` finds `Create unbreakable box area`.
- Running a command changes state.
- Menus, toolbar buttons, and command palette call the same command object.
- Agent panel can list suggested command IDs.
