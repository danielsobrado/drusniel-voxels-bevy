# CLOD-POC River Mist Shared Mask Status

> Updated: 2026-07-19  
> Target: `tools/clod-poc`  
> Parent status: `docs/plans/clod-poc-glacial-valley-effects-status-2026-07-19.md`

## Delivery slice

This slice routes the live river-mist emitter through the same deterministic river-mist mask formula used by the environmental-mask evaluator.

PR #246 already moved river-mist water and river sampling to the active production `EnvironmentQuery`. The remaining drift was the signal formula: the live emitter maintained a private copy while the generic environmental-mask layer used a separate implementation.

## Implemented

- one shared river-mist mask function owns the production signal formula;
- the generic scalar and batched environmental-mask paths continue to use that formula;
- the live river-mist emitter consumes the same formula after EnvironmentQuery sampling;
- live safety gates are retained for river identity, minimum depth, minimum wet coverage, finite flow, and non-negative shore distance;
- invalid water or river authority fails closed;
- scan budgets, particle budgets, spawning, movement, rendering, fallback sampling, and diagnostics remain unchanged;
- focused tests lock generic-mask and live-emitter parity.

## Scope boundary

This is the first isolated normal-gameplay environmental-mask consumer migration. It does not migrate river-bank residue, cascade particles, the CPU stone oracle, sunbeam motes, future rapid droplets, calm-water rings, frost, dew, or shore debris. Those remain separate reviewable slices.

## Acceptance still required

- repository typecheck, focused tests, and production build;
- headed `infinite-islands` proof at deterministic river and non-river poses;
- environment-query samples non-zero with legacy fallback zero in active hydrology scenes;
- no mist in dry, shallow, lake, invalid-authority, or negative-shore samples;
- no new frame spike, GPU readback, or WebGPU error.
