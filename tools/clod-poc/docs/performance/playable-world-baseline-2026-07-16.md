# Playable-world honest baseline — 2026-07-16

Deterministic scripted run (600 s simulated at 120 Hz fixed step): walk +
sprint + jump every 7 s + dig every 20 s + periodic teleports + one cave-void teleport
(minute 5) + a walk at a never-streamed frontier (minute 8). Synthetic 640 m world,
seeded route; harness: `tools/playable_baseline/playable_baseline.ts` (vitest-driven,
same collider/controller code as the app).

Legacy = pre-contract configuration (unrestricted height fallback, synchronous collider
rebuilds, no frontier barrier). Contract = P1/P2 wiring (certified fallback, async
revision-validated rebuilds, barrier, readiness-gated teleports).

| counter | legacy | contract |
|---|---|---|
| collider_apply_ms | — | 0.00 |
| collider_build_count | 307 | 317 |
| collider_build_total_ms | 25.54 | 17.90 |
| collider_exact_no_ground | 28106 | 23774 |
| collider_jobs_completed | — | 217 |
| collider_jobs_inflight | — | 0 |
| collider_jobs_queued | — | 217 |
| collider_queue_latency_max_ms | — | 1.80 |
| collider_queue_latency_ms | — | 1.40 |
| collider_stale_frames | — | 192 |
| collider_sync_frame_build_ms | 12.53 | — |
| collider_sync_frame_builds | 207 | — |
| fallback_denied_uncertified | — | 2204 |
| fallback_heightfield_certified | 13001 | 1989 |
| frontier_barrier_engagements | — | 22473 |

| observation | legacy | contract |
|---|---|---|
| invented-floor frames in cave | 62 | 0 |
| invented-floor frames in unstreamed zone | 4033 | 0 |
| entered unstreamed zone | true | false |
| reached real cave floor | false | true |
| digs / teleports / jumps | 29 / 5 / 85 | 29 / 5 / 85 |
| wall clock (ms) | 274 | 336 |
