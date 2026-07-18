import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditCommand, type EditCommandOperation } from "../player/edit_commands.js";
import {
  authorizeConstructionRemoval,
  createConstructionRemoveAuthorizer,
  installConstructionRemoveAuthorizer,
  type ConstructionRemoveAuthorityDeps,
} from "./construction_remove_authority.js";

const target = {
  id: "piece-1",
  position: [10, 2, -5] as const,
};

let disposeAuthorizer: (() => void) | null = null;

afterEach(() => {
  disposeAuthorizer?.();
  disposeAuthorizer = null;
});

function deps(overrides: Partial<ConstructionRemoveAuthorityDeps> = {}): ConstructionRemoveAuthorityDeps {
  return {
    getActorPosition: () => ({ x: 12, z: -5 }),
    getCurrentMode: () => "playing",
    getTerrainRevision: () => 7,
    getMaxDistanceM: () => 8,
    targetReadyAt: () => true,
    nowMs: () => 100,
    ...overrides,
  };
}

function install(overrides: Partial<ConstructionRemoveAuthorityDeps> = {}): void {
  disposeAuthorizer = installConstructionRemoveAuthorizer(
    createConstructionRemoveAuthorizer(deps(overrides)),
  );
}

function command(
  operation: EditCommandOperation = "construction_remove",
  position: readonly [number, number, number] = target.position,
) {
  return createEditCommand({
    operation,
    targetPosition: position,
    targetNormal: [0, 1, 0],
    sourceTerrainRevision: 7,
    actor: "player",
    mode: "playing",
    nowMs: 50,
  });
}

describe("construction remove authority", () => {
  it("allows a current, ready, in-range removal", () => {
    install();
    expect(authorizeConstructionRemoval(target)).toEqual({ allowed: true });
  });

  it("denies removal outside the live build radius", () => {
    const onDenied = vi.fn();
    install({
      getActorPosition: () => ({ x: 100, z: 100 }),
      onDenied,
    });

    expect(authorizeConstructionRemoval(target)).toEqual({
      allowed: false,
      reason: "out_of_range",
    });
    expect(onDenied).toHaveBeenCalledWith("out_of_range", target);
  });

  it("denies removal while the target is not ready", () => {
    install({ targetReadyAt: () => false });
    expect(authorizeConstructionRemoval(target)).toEqual({
      allowed: false,
      reason: "not_ready",
    });
  });

  it("denies a queued removal after the interaction mode changes", () => {
    install({ getCurrentMode: () => "orbit" });
    expect(authorizeConstructionRemoval(target, command())).toEqual({
      allowed: false,
      reason: "mode_changed",
    });
  });

  it("denies a queued removal after the terrain revision changes", () => {
    install({ getTerrainRevision: () => 8 });
    expect(authorizeConstructionRemoval(target, command())).toEqual({
      allowed: false,
      reason: "revision_mismatch",
    });
  });

  it("rejects a queued command for another operation or target", () => {
    install();
    expect(authorizeConstructionRemoval(target, command("terrain_dig"))).toEqual({
      allowed: false,
      reason: "target_moved",
    });
    expect(authorizeConstructionRemoval(target, command("construction_remove", [11, 2, -5]))).toEqual({
      allowed: false,
      reason: "target_moved",
    });
  });

  it("fails closed for malformed targets and authority dependencies", () => {
    install();
    expect(authorizeConstructionRemoval({ id: "", position: [Number.NaN, 0, 0] })).toEqual({
      allowed: false,
      reason: "not_ready",
    });
    disposeAuthorizer?.();
    disposeAuthorizer = null;
    install({ getTerrainRevision: () => { throw new Error("revision unavailable"); } });
    expect(authorizeConstructionRemoval(target)).toEqual({
      allowed: false,
      reason: "not_ready",
    });
  });

  it("does not resurrect a disposed authorizer when runtimes dispose out of order", () => {
    const disposeFirst = installConstructionRemoveAuthorizer(() => ({
      allowed: false,
      reason: "out_of_range",
    }));
    const disposeSecond = installConstructionRemoveAuthorizer(() => ({ allowed: true }));
    try {
      expect(authorizeConstructionRemoval(target)).toEqual({ allowed: true });
      disposeFirst();
      expect(authorizeConstructionRemoval(target)).toEqual({ allowed: true });
      disposeSecond();
      expect(authorizeConstructionRemoval(target)).toEqual({
        allowed: false,
        reason: "not_ready",
      });
    } finally {
      disposeFirst();
      disposeSecond();
    }
  });

  it("fails closed when no authorizer is installed", () => {
    expect(authorizeConstructionRemoval(target)).toEqual({
      allowed: false,
      reason: "not_ready",
    });
  });

  it("fails closed when the actor origin is unavailable", () => {
    install({ getActorPosition: () => null });
    expect(authorizeConstructionRemoval(target)).toEqual({
      allowed: false,
      reason: "not_ready",
    });
  });
});
