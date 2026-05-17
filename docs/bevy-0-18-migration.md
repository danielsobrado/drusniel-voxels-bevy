# Bevy 0.18 Migration Record

Document status (2026-05-17): historical migration record. The migration is complete; the current repo baseline is Bevy `0.18.1`.

**Last reviewed:** 2026-05-17
**Previous Bevy baseline:** 0.17
**Current Bevy baseline:** 0.18.1
**Source of truth:** `Cargo.toml` and `Cargo.lock`

## Current State

This project has already moved from Bevy 0.17 to Bevy 0.18.1. Do not use this document as a pending migration checklist. Use it to understand the dependency baseline and the historical reasons for the upgrade.

Current Bevy-family dependency versions in `Cargo.toml`:

| Crate | Current Version | Role |
|-------|-----------------|------|
| `bevy` | 0.18.1 | Main engine |
| `bevy_mesh` | 0.18.1 | Mesh APIs used directly |
| `bevy_shader` | 0.18.1 | Shader APIs used directly |
| `bevy_water` | 0.18.1 | Water rendering |
| `bevy_egui` | 0.39.1 | Editor/debug UI |
| `bevy-inspector-egui` | 0.36.0 | Inspector tooling |
| `bevy_hanabi` | 0.18.0 | Particle effects |
| `bevy_mod_outline` | 0.12.0 | Outline rendering |
| `bevy_tweening` | 0.15.0 | Tween animation |
| `bevy-tnua` | 0.30.0 | Character movement |
| `bevy-tnua-avian3d` | 0.10.0 | Tnua/Avian integration |

Related runtime/rendering dependencies:

| Crate | Current Version | Notes |
|-------|-----------------|-------|
| `avian3d` | 0.5 | Physics backend |
| `leafwing-input-manager` | 0.20.0 | Input mapping |
| `iyes_progress` | 0.16.0 | Progress/loading helpers |
| `wgpu` | 27.0.1 | GPU backend version used directly |

## Migration Outcome

The old blockers are resolved for the current codebase:

- `avian3d` is now on the compatible `0.5` line.
- `bevy-tnua` and `bevy-tnua-avian3d` are on Bevy 0.18-compatible versions.
- `bevy_egui` and `bevy-inspector-egui` have moved past the old release-candidate/pending state.
- `bevy_hanabi`, `bevy_mod_outline`, `bevy_tweening`, and `bevy_water` are no longer listed as migration blockers.

## Historical Migration Resources

- [Bevy 0.18 Release Notes](https://bevy.org/news/bevy-0-18/)
- [0.17 to 0.18 Migration Guide](https://bevy.org/learn/migration-guides/0-17-to-0-18/)
- [Bevy GitHub Releases](https://github.com/bevyengine/bevy/releases)

## Guidance For Future Work

- Treat Bevy `0.18.1` as the current implementation baseline unless `Cargo.toml` changes.
- If a doc or code comment still says the project is on Bevy 0.17, that text is stale.
- If a doc is explicitly about Bevy 0.17, keep it only as historical/reference material and verify API snippets before using them.
- Any future Bevy upgrade should get a new migration record rather than reviving the old 0.17-to-0.18 checklist.

## Update Log

| Date | Update |
|------|--------|
| 2026-01-19 | Original pending migration tracker created after Bevy 0.18.0 release. |
| 2026-05-17 | Rewritten as a completed migration record. Current repo baseline is Bevy 0.18.1. |
