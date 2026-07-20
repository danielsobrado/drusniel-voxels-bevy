# CLOD-POC Sunbeam Mote Shared Mask Status

> Updated: 2026-07-19  
> Target: `tools/clod-poc`  
> Dependency: PR #258

## Delivery slice

This slice publishes one canonical sunbeam-mote airborne state and routes the live mote runtime through it.

The live GPU materials already apply configured strength and the sun-visibility atlas per particle. The remaining drift was the CPU visual state: live motes used pollen plus frost, while the generic environmental-mask formula used morning mist plus reduced pollen and ignored frost.

## Implemented

- one reusable airborne-state function combines morning mist, pollen, and frost;
- seasonal pollen/frost remains capped and deterministic;
- frost-only motes remain cold, pollen-only motes remain warm;
- morning mist can sustain airborne particles when seasonal particles are absent;
- the live weather controller continues passing only amount, cold blend, and local mist;
- WebGL and WebGPU materials retain GPU sun-atlas visibility, configured strength, forward scatter, and local-mist modulation;
- no CPU per-particle query, EnvironmentQuery read, GPU readback, or new frame loop is introduced;
- focused math, runtime, and renderer-source tests are included.

## Scope boundary

This is a prerequisite for replacing the generic environmental-mask sunbeam formula with the same helper. That call-site remains a dependent follow-up because PR #258 already changes the central mask-math file.

No particle geometry, shader noise, atlas ownership, visibility thresholds, density, opacity, update period, weather mode, or lil-gui controls are changed.

## Acceptance still required

- repository typecheck, focused tests, and production build;
- fixed morning-mist, pollen-only, frost-only, and mixed-season captures;
- WebGL/WebGPU visual parity;
- no motes when biome visual state is disabled;
- no material frame spike, GPU readback, or uncaptured WebGPU error.
