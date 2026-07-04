import { describe, expect, it } from "vitest";
import {
  canCommitBuild,
  canCommitTerrainEdit,
  canPreviewBuild,
  publishPlayerEditAuthorityDecision,
  resolvePlayerEditAuthorityConfig,
} from "./player_edit_authority.js";

const YAML = `
player_editing:
  terrain_edit_radius_m: 96
  build_commit_radius_m: 80
  build_preview_radius_m: 160
  allow_far_preview: true
  allow_far_commit: false
`;

describe("player edit authority", () => {
  it("loads yaml and query overrides", () => {
    const params = new URLSearchParams("playerEditTerrainRadius=42&playerAllowFarCommit=1");
    const config = resolvePlayerEditAuthorityConfig(YAML, params);

    expect(config.terrainEditRadiusM).toBe(42);
    expect(config.buildCommitRadiusM).toBe(80);
    expect(config.allowFarCommit).toBe(true);
  });

  it("rejects terrain commits outside the player authority radius", () => {
    const config = resolvePlayerEditAuthorityConfig(YAML);
    const decision = canCommitTerrainEdit(config, { x: 0, z: 0 }, { x: 120, z: 0 });

    expect(decision.allowed).toBe(false);
    expect(decision.distanceM).toBe(120);
  });

  it("allows build preview farther than build commit", () => {
    const config = resolvePlayerEditAuthorityConfig(YAML);

    expect(canPreviewBuild(config, { x: 0, z: 0 }, [120, 0, 0]).allowed).toBe(true);
    expect(canCommitBuild(config, { x: 0, z: 0 }, [120, 0, 0]).allowed).toBe(false);
  });

  it("allows editor/orbit commits when no player authority origin is supplied", () => {
    const config = resolvePlayerEditAuthorityConfig(YAML);

    expect(canCommitTerrainEdit(config, null, { x: 4096, z: 4096 }).allowed).toBe(true);
    expect(canCommitBuild(config, null, [4096, 0, 4096]).allowed).toBe(true);
  });

  it("publishes stable counters", () => {
    const counters: Record<string, number> = {};
    const config = resolvePlayerEditAuthorityConfig(YAML);
    publishPlayerEditAuthorityDecision(counters, canCommitBuild(config, { x: 0, z: 0 }, [120, 0, 0]));

    expect(counters.player_build_commit_allowed).toBe(0);
    expect(counters.player_build_commit_rejected_distance).toBe(1);
    expect(counters.player_build_commit_limit_m).toBe(80);
  });
});
