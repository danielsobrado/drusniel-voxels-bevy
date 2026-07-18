import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditCommand } from "../player/edit_commands.js";
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

  it("denies a queued removal after mode or terrain revision changes", () => {
    install({
      getCurrentMode: () => "orbit",
      getTerrainRevision: () => 8,
    });
    const command = createEditCommand({
      operation: "construction_remove",
      targetPosition: target.position,
      targetNormal: [0, 1, 0],
      sourceTerrainRevision: 7,
      actor: "player",
      mode: "playing",
      nowMs: 50,
    });

    expect(authorizeConstructionRemoval(target, command)).toEqual({
      allowed: false,
      reason: "mode_changed",
    });
  });

  it("fails closed when an authority dependency throws", () => {
    install({ getTerrainRevision: () => { throw new Error("revision unavailable"); } });
    expect(authorizeConstructionRemoval(target)).toEqual({
      allowed: false,
      reason: "not_ready",
    });
  });
});
