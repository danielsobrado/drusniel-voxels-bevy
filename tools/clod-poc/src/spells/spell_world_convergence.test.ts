import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_EARTH_SPELL_GAMEPLAY_CONFIG } from "./earth_spell_gameplay_config.js";
import {
  executePreparedEarthSpellCast,
  prepareEarthSpellCast,
} from "./spell_world_convergence.js";
import type {
  TerrainSpellEditRequest,
  TerrainSpellEditResult,
} from "../terrain/editing/terrain_edit_service.js";

const convergedResult: TerrainSpellEditResult = {
  committed: true,
  changed: true,
  converged: true,
  reason: null,
  editRevision: 12,
};

describe("earth spell world convergence", () => {
  it("captures an immutable non-replayable spell command", () => {
    const point = new THREE.Vector3(10, 4, 20);
    const prepared = prepareEarthSpellCast(
      { point, normal: new THREE.Vector3(0, 1, 0) },
      DEFAULT_EARTH_SPELL_GAMEPLAY_CONFIG,
      { terrainRevision: 7, actor: "player", mode: "playing", nowMs: 100 },
    );
    expect(prepared).not.toBeNull();
    point.set(99, 99, 99);

    expect(prepared!.request.command).toMatchObject({
      operation: "spell_cast",
      targetPosition: [10, 4, 20],
      sourceTerrainRevision: 7,
      mode: "playing",
      expiresAtMs: 3100,
    });
    expect(prepared!.request.edit).toMatchObject({
      x: 10,
      y: 4,
      z: 20,
      r: 2.4,
      shape: "sphere",
      op: "remove",
    });
    expect(Object.isFrozen(prepared!.request.command)).toBe(true);
  });

  it("commits authority immediately and defers only VFX until warmup", async () => {
    let resolveReady: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => { resolveReady = resolve; });
    const prepared = prepareEarthSpellCast(
      { point: new THREE.Vector3(2, 3, 4) },
      DEFAULT_EARTH_SPELL_GAMEPLAY_CONFIG,
      { terrainRevision: 2, actor: "player", mode: "playing", nowMs: 0 },
    )!;
    const order: string[] = [];
    const commitSpellTerrainEdit = vi.fn(async (
      _request: TerrainSpellEditRequest,
      onCommit?: () => void,
    ): Promise<TerrainSpellEditResult> => {
      order.push("authority");
      onCommit?.();
      order.push("derived");
      return convergedResult;
    });
    const playVfx = vi.fn(() => {
      order.push("vfx");
      return true;
    });
    const waitForDerivedConvergence = vi.fn(async () => {
      order.push("runtime-queues");
    });

    const execution = executePreparedEarthSpellCast(prepared, {
      ready,
      terrainEditService: { commitSpellTerrainEdit },
      playVfx,
      waitForDerivedConvergence,
    });
    await Promise.resolve();
    expect(commitSpellTerrainEdit).toHaveBeenCalledOnce();

    const result = await execution;
    expect(result).toEqual(convergedResult);
    expect(order).toEqual(["authority", "derived", "runtime-queues"]);
    expect(waitForDerivedConvergence).toHaveBeenCalledOnce();

    resolveReady();
    await Promise.resolve();
    expect(order).toEqual(["authority", "derived", "runtime-queues", "vfx"]);
  });

  it("returns a failed convergence result when runtime queues time out", async () => {
    const prepared = prepareEarthSpellCast(
      { point: new THREE.Vector3(2, 3, 4) },
      DEFAULT_EARTH_SPELL_GAMEPLAY_CONFIG,
      { terrainRevision: 2, actor: "player", mode: "playing", nowMs: 0 },
    )!;
    const onResult = vi.fn();
    const result = await executePreparedEarthSpellCast(prepared, {
      ready: Promise.resolve(),
      terrainEditService: {
        commitSpellTerrainEdit: vi.fn(async (): Promise<TerrainSpellEditResult> => convergedResult),
      },
      playVfx: vi.fn(() => true),
      waitForDerivedConvergence: vi.fn(async () => {
        throw new Error("collider convergence timeout");
      }),
      onResult,
    });

    expect(result).toEqual({
      ...convergedResult,
      converged: false,
      reason: "collider convergence timeout",
    });
    expect(onResult).toHaveBeenCalledWith(result);
  });

  it("does not play VFX when command validation denies the terrain edit", async () => {
    const prepared = prepareEarthSpellCast(
      { point: new THREE.Vector3(2, 3, 4) },
      DEFAULT_EARTH_SPELL_GAMEPLAY_CONFIG,
      { terrainRevision: 2, actor: "player", mode: "playing", nowMs: 0 },
    )!;
    const denied: TerrainSpellEditResult = {
      committed: false,
      changed: false,
      converged: false,
      reason: "revision_mismatch",
      editRevision: 3,
    };
    const playVfx = vi.fn(() => true);
    const waitForDerivedConvergence = vi.fn();

    const result = await executePreparedEarthSpellCast(prepared, {
      ready: Promise.resolve(),
      terrainEditService: {
        commitSpellTerrainEdit: vi.fn(async (): Promise<TerrainSpellEditResult> => denied),
      },
      playVfx,
      waitForDerivedConvergence,
    });

    expect(result).toEqual(denied);
    expect(playVfx).not.toHaveBeenCalled();
    expect(waitForDerivedConvergence).not.toHaveBeenCalled();
  });
});
