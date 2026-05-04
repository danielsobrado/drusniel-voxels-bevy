# Sprint 12 — Agent Workbench MVP

Phase: 4 — LLM-first editor

## Goal
Make the UI readable and operable by an LLM agent.

## Subtasks
- Implement `AgentWorkbenchPanel`.
- Add sections:
  - Screen Understanding
  - Current Selection
  - Active Mode
  - Visible Panels
  - Suggested Commands
  - Task Plan
  - Observe ? Plan ? Act ? Verify timeline
  - Test Results
  - JSON Observation
- Add `AgentObservationCard`.
- Add `AgentTimeline`.
- Add `AgentVerificationPanel`.
- Add command buttons:
  - observe screen
  - run plan
  - approve step
  - reject step
  - generate Playwright test
  - compare before/after
  - save snapshot
- Add stable JSON observation object:

```ts
type AgentObservation = {
  activeMode: EditorMode;
  activeTool: string;
  selected: Selection | null;
  visiblePanels: string[];
  viewport: {
    cameraPosition: [number, number, number];
    targetVoxel?: [number, number, number];
    overlays: string[];
  };
  brush: BrushSettings;
  dirtyChunks: number;
  warnings: string[];
  suggestedCommands: string[];
};
```

- Add screen-readable summaries to every panel:
  - `aria-label`
  - `data-testid`
  - `data-command-id`
  - visible `Agent Hint`
- Add Playwright accessibility snapshot test.

## Acceptance criteria
- Agent panel shows current selected object.
- Agent can run command IDs.
- Agent can generate a mocked test.
- Every main action has stable `data-testid`.
- Playwright can operate the editor without relying on pixel positions.
