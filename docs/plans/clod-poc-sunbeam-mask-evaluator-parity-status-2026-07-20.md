# CLOD-POC Sunbeam Mask Evaluator Parity Status

> Updated: 2026-07-20  
> Target: `tools/clod-poc`  
> Dependency: PR #259

## Delivery slice

This slice routes the generic environmental-mask evaluator through the canonical sunbeam-mote helper introduced by PR #259.

Before this change, the live renderer and debug/batch mask paths used different airborne formulas. The live path accounted for morning mist, pollen, and frost, while the generic mask used morning mist plus reduced pollen and ignored frost.

## Implemented

- `evaluateEnvironmentalMaskValues()` delegates sunbeam-mote evaluation to `evaluateSunbeamMoteMaskValue()`;
- scalar environmental-mask evaluation inherits the canonical result;
- allocation-reused batch evaluation inherits the same result without extra authority queries or allocations;
- morning-mist-only, frost-only, pollen/frost mixed, and invalid-visibility cases are parity tested;
- existing visibility ownership remains the shared sun-visibility field;
- existing scalar/batch parity tests remain applicable;
- no renderer, particle geometry, shader, atlas, query cadence, or GPU readback behavior changes.

## Scope boundary

This PR completes sunbeam-mote formula parity only. It does not add mask debug overlays, distribution counters, rapid droplets, calm-pool rings, frost/dew material consumers, or new EnvironmentQuery reads.

## Acceptance still required

- repository typecheck, focused tests, and production build;
- run the existing scalar/batch parity suite;
- headed comparison of mask probe and live motes at fixed mist-only, pollen-only, frost-only, and mixed states;
- confirm invalid visibility produces zero generic mask and no rendered motes;
- confirm unchanged CPU update, render cost, gameplay readbacks, and WebGPU errors.
