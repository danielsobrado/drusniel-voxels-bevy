# Drusniel Development Ownership

## Main Developer

**Daniel Sobrado** is the main developer for Drusniel.

Daniel is responsible for generating, reviewing, and integrating the code for both active applications:

1. **clod-poc** — the Three.js/WebGPU proof-of-concept application under `tools/clod-poc`.
2. **Main Drusniel Rust/Bevy application** — the production Rust/Bevy application.

## Ownership Rules

- Daniel owns final code direction for both applications.
- AI agents may assist with planning, code generation, refactoring, review, testing, and documentation.
- Generated code must remain aligned with Daniel's architecture decisions and repository rules.
- Implementation plans must clearly separate work that belongs in `clod-poc` from work that belongs in the main Rust/Bevy application.
- Shared concepts may be prototyped in `clod-poc`, but production integration decisions remain Daniel's responsibility.

## Agent Role

AI agents are implementation assistants, not final owners.

Their role is to:

- propose plans,
- generate candidate code,
- write tests,
- update documentation,
- surface risks,
- explain trade-offs,
- and keep changes small and reviewable.

They must not silently change the intended product direction or treat either application as independently owned by the agent.

## Application Boundary

When a task mentions **both applications**, it means:

- `tools/clod-poc` for the WebGPU/Three.js experimental path,
- and the main Rust/Bevy Drusniel application for the production path.

Each plan should state whether the change is:

- clod-poc only,
- main Rust/Bevy only,
- or shared concept with separate implementations.
