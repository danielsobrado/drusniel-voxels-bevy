// Edit command validation (playable-world-contract P1.3): deny by default, immutable
// commands, strict execution-time validation, no silent replay for dig/casts.
import { describe, expect, it } from "vitest";
import {
  createEditCommand,
  validateEditCommand,
  editCommandMayRetryAcrossRevisions,
  DEFAULT_EDIT_COMMAND_EXPIRY_MS,
  type EditCommandContext,
  type ModedEditCommand,
} from "./edit_commands.js";

function command(overrides: Partial<Parameters<typeof createEditCommand>[0]> = {}): ModedEditCommand {
  return createEditCommand({
    operation: "terrain_dig",
    targetPosition: [10, 5, -20],
    targetNormal: [0, 1, 0],
    sourceTerrainRevision: 7,
    actor: "player",
    mode: "playing",
    nowMs: 1000,
    ...overrides,
  });
}

function context(overrides: Partial<EditCommandContext> = {}): EditCommandContext {
  return {
    nowMs: 1100,
    currentTerrainRevision: 7,
    actorPosition: { x: 12, z: -21 },
    maxDistanceM: 8,
    currentMode: "playing",
    ...overrides,
  };
}

describe("edit commands", () => {
  it("commands are immutable snapshots", () => {
    const cmd = command();
    expect(Object.isFrozen(cmd)).toBe(true);
    expect(Object.isFrozen(cmd.targetPosition)).toBe(true);
    expect(cmd.expiresAtMs).toBe(1000 + DEFAULT_EDIT_COMMAND_EXPIRY_MS);
  });

  it("a fresh command in range at the same revision executes", () => {
    expect(validateEditCommand(command(), context())).toEqual({ allowed: true });
  });

  it("expiry denies: a click seconds later is a bug, not resilience", () => {
    expect(validateEditCommand(command(), context({ nowMs: 1000 + DEFAULT_EDIT_COMMAND_EXPIRY_MS + 1 })))
      .toEqual({ allowed: false, reason: "expired" });
  });

  it("dig strikes NEVER silently replay across a terrain revision bump", () => {
    expect(validateEditCommand(command(), context({ currentTerrainRevision: 8 })))
      .toEqual({ allowed: false, reason: "revision_mismatch" });
    // Even a targetStillValid oracle cannot rescue a non-replayable operation.
    expect(validateEditCommand(command(), context({ currentTerrainRevision: 8, targetStillValid: () => true })))
      .toEqual({ allowed: false, reason: "revision_mismatch" });
    expect(editCommandMayRetryAcrossRevisions("terrain_dig")).toBe(false);
    expect(editCommandMayRetryAcrossRevisions("spell_cast")).toBe(false);
  });

  it("construction ghosts may retry across revisions ONLY via latest-revision re-validation", () => {
    const ghost = command({ operation: "construction_place" });
    expect(editCommandMayRetryAcrossRevisions("construction_place")).toBe(true);
    // No validation oracle wired → deny (fails closed).
    expect(validateEditCommand(ghost, context({ currentTerrainRevision: 9 })))
      .toEqual({ allowed: false, reason: "target_moved" });
    // Oracle confirms the same world feature is still targeted → place.
    expect(validateEditCommand(ghost, context({ currentTerrainRevision: 9, targetStillValid: () => true })))
      .toEqual({ allowed: true });
    // Oracle says the terrain moved under the ghost → deny with feedback.
    expect(validateEditCommand(ghost, context({ currentTerrainRevision: 9, targetStillValid: () => false })))
      .toEqual({ allowed: false, reason: "target_moved" });
  });

  it("interaction distance is re-checked at execution time", () => {
    expect(validateEditCommand(command(), context({ actorPosition: { x: 100, z: 100 } })))
      .toEqual({ allowed: false, reason: "out_of_range" });
  });

  it("a mode change between creation and execution denies", () => {
    expect(validateEditCommand(command(), context({ currentMode: "orbit" })))
      .toEqual({ allowed: false, reason: "mode_changed" });
  });

  it("an unready target cell denies with not_ready", () => {
    expect(validateEditCommand(command(), context({ targetReady: false })))
      .toEqual({ allowed: false, reason: "not_ready" });
  });
});
