# Sprint 19 � Performance and large-world UX

Document status (2026-05-17): planning record; use for rationale and sequencing, not as current execution instructions unless reconciled with code first.

Phase: 6 � Production hardening

## Goal
Make the editor handle thousands of objects and chunks.

## Subtasks
- Virtualize outliner lists.
- Virtualize asset browser.
- Virtualize console logs.
- Add debounced inspector forms.
- Add memoized selectors.
- Add render profiling in React.
- Add stress-test mock data:
  - 4,000 props
  - 1,000 chunks
  - 200 protected areas
  - 100 water bodies
  - 10,000 logs
- Add panel performance tests.

## Acceptance criteria
- Large mock world remains responsive.
- Outliner scrolls smoothly.
- Console can handle many logs.
- No huge React re-render spikes on selection.
