# Bevy 0.18 Migration Tracking

**Last Updated:** 2026-01-19
**Current Bevy Version:** 0.17
**Target Bevy Version:** 0.18.0 (released 2026-01-18)

## Overview

This document tracks the compatibility status of our dependencies with Bevy 0.18. We will review this periodically to determine when we can safely upgrade.

## Migration Resources

- [Bevy 0.18 Release Notes](https://bevy.org/news/bevy-0-18/)
- [0.17 to 0.18 Migration Guide](https://bevy.org/learn/migration-guides/0-17-to-0-18/)
- [Bevy GitHub Releases](https://github.com/bevyengine/bevy/releases)

## Dependency Compatibility Status

### Legend
- Ready: Confirmed Bevy 0.18 support available
- RC: Release candidate available for 0.18
- Pending: No 0.18 version yet, check back later
- Unknown: Status needs verification

### Core Bevy Crates

| Crate | Current Version | 0.18 Status | Notes |
|-------|----------------|-------------|-------|
| bevy | 0.17 | Ready | 0.18.0 released |
| bevy_mesh | 0.17 | Ready | Part of bevy core |
| bevy_shader | 0.17 | Ready | Part of bevy core |

### UI/Editor Crates

| Crate | Current Version | 0.18 Status | 0.18 Version | Notes |
|-------|----------------|-------------|--------------|-------|
| bevy_egui | 0.38.1 | RC | Check repo | RC versions available |
| bevy-inspector-egui | 0.35.0 | Pending | - | Check [GitHub](https://github.com/jakobhellermann/bevy-inspector-egui) |

### Physics/Movement Crates

| Crate | Current Version | 0.18 Status | 0.18 Version | Notes |
|-------|----------------|-------------|--------------|-------|
| avian3d | 0.4 | Pending | - | Check [GitHub](https://github.com/Jondolf/avian) |
| bevy-tnua | 0.26 | Pending | - | Check [GitHub](https://github.com/idanarye/bevy-tnua) |
| bevy-tnua-avian3d | 0.8 | Pending | - | Depends on avian3d update |

### Input/Navigation Crates

| Crate | Current Version | 0.18 Status | 0.18 Version | Notes |
|-------|----------------|-------------|--------------|-------|
| leafwing-input-manager | 0.19.0 | Pending | - | Check [GitHub](https://github.com/Leafwing-Studios/leafwing-input-manager) |
| oxidized_navigation | 0.12.0 | Pending | - | Check [GitHub](https://github.com/TheGrimsey/oxidized_navigation) |

### Visual Effects Crates

| Crate | Current Version | 0.18 Status | 0.18 Version | Notes |
|-------|----------------|-------------|--------------|-------|
| bevy_hanabi | 0.17.0 | Pending | - | Particle effects, check [GitHub](https://github.com/djeedai/bevy_hanabi) |
| bevy_mod_outline | 0.10.3 | Pending | - | Check [GitHub](https://github.com/komadori/bevy_mod_outline) |
| bevy_water | 0.17 | Pending | - | Check source for updates |

### Animation/Utility Crates

| Crate | Current Version | 0.18 Status | 0.18 Version | Notes |
|-------|----------------|-------------|--------------|-------|
| bevy_tweening | 0.14.0 | Pending | - | Check [GitHub](https://github.com/djeedai/bevy_tweening) |
| iyes_progress | 0.15.0 | Pending | - | Check [GitHub](https://github.com/IyesGames/iyes_progress) |

### Non-Bevy Dependencies (No Migration Needed)

| Crate | Version | Notes |
|-------|---------|-------|
| serde | 1.0 | Stable, no changes needed |
| serde_yaml | 0.9 | Stable |
| serde_json | 1.0 | Stable |
| log | 0.4 | Stable |
| thiserror | 2.0 | Stable |
| fast-surface-nets | 0.2 | Stable |
| ndshape | 0.3 | Stable |
| bincode | 1.3 | Stable |
| pollster | 0.4.0 | Stable |
| wgpu | 26.0.1 | May need update with Bevy 0.18 |
| rand | 0.8 | Stable |

## Migration Blockers

Current blockers preventing migration:

1. **avian3d** - Critical for physics, must wait for 0.18 support
2. **bevy-tnua** - Character controller, depends on avian3d
3. **bevy_hanabi** - Particle effects throughout the game
4. **leafwing-input-manager** - Input handling
5. **bevy_egui** - UI system (RC may be usable)

## Bevy 0.18 Notable Changes

Key changes that may affect our codebase:

1. **Cargo Feature Collections** - New "2d", "3d", "ui" feature presets
2. **Module reorganization** - Some items may have moved
3. **API changes** - Check migration guide for breaking changes

## How to Check Dependency Status

For each crate, check:

1. **crates.io** - Search for the crate and check latest version compatibility
2. **GitHub Releases** - Check the releases page for 0.18 support announcements
3. **GitHub README** - Most crates have a version compatibility table
4. **Cargo.toml** - Look for bevy version in the crate's dependencies

## Action Items

- [ ] Check bevy_egui RC compatibility
- [ ] Monitor avian3d for 0.18 release
- [ ] Monitor bevy-tnua for 0.18 release
- [ ] Monitor bevy_hanabi for 0.18 release
- [ ] Test bevy_water with 0.18 (may need fork/patch)
- [ ] Review Bevy 0.18 migration guide for code changes

## Update Log

| Date | Update |
|------|--------|
| 2026-01-19 | Initial document created. Bevy 0.18.0 released 2026-01-18. |

---

*Review this document weekly or when notified of major ecosystem updates.*
