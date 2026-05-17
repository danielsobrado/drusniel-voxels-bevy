# Gravity System Performance Issues

Document status (2026-05-17): current technical note; verify file paths against code when editing.

## Status: Deactivated (2025-12-11)

The gravity system implemented for handling disconnected voxels has been deactivated due to performance concerns.

### Implementation Details
- **Logic**: Scanning chunks for "hanging" blocks (air underneath) and performing a BFS connectivity check to find stable ground.
- **Optimization**: "Hanging Check" was implemented to avoid BFS on grounded blocks (99% of cases).
- **Throughput**: Tuned to 16 chunks per tick (approx 320 chunks/sec).

### Issues Observed
1.  **Hang on Startup**: When scanning many chunks, the main thread can still be blocked, causing a noticeable freeze or stutter.
2.  **Scalability**: The current "sweep" approach doesn't scale well with world size. Checking thousands of chunks, even with optimizations, consumes too much frame time.
3.  **Future Solution Needed**: A more reactive or event-based system is needed. Instead of sweeping, gravity checks should probably only trigger on:
    -   Voxel destruction events (check neighbors).
    -   World generation completion (one-time pass, maybe async).
    -   Chunk loading (async).

### Next Steps
- Re-architect gravity to be event-driven rather than a continuous poll.
- Or, move the calculation entirely to a background thread (AsyncCompute) so it doesn't block the frame.
