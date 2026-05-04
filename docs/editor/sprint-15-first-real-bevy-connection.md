# Sprint 15 — First real Bevy connection

Phase: 5 — Runtime integration

## Goal
Connect the editor to live read-only runtime state first.

## Subtasks
- Add Bevy-side editor API module.
- Expose read-only data:
  - render quality
  - graphics capabilities
  - render timings
  - water reflection status
  - water visual debug state
  - atlas mapping
  - selected/targeted block if available
  - chunk summaries
  - prop stats
- Connect React with TanStack Query.
- Add live status indicators:
  - connected
  - disconnected
  - runtime paused
  - stale data
  - error
- Add refresh commands.
- Add safe fallback to mocks.

## Acceptance criteria
- Editor can show live runtime status.
- Disconnecting runtime does not crash UI.
- Mock mode still works.
- Render quality and water/debug data can be viewed live.
