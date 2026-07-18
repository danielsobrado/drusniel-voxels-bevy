import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  gameplayDiagnostics,
  resetGameplayDiagnosticsForTests,
} from "../../player/gameplay_diagnostics.js";
import type { TerrainRaycastService } from "../../player/terrain_raycast_service.js";
import type { TerrainBrushParams, TerrainEditService, TerrainSpellEditResult } from "./terrain_edit_service.js";
import { createCommandGuardedTerrainEditService } from "./terrain_edit_command_service.js";

const ray = new THREE.Ray(new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, -1, 0));
const hit = { point: new THREE.Vector3(0, 5, 0), distance: 5, pageId: "page-0" };

function brush(overrides: Partial<TerrainBrushParams> = {}): TerrainBrushParams {
  return {
    digRadius: 1,
    brushShape: "sphere",
    brushOp: "remove",
    brushMaterial: 0,
    brushHeight: 1,
    brushStrength: 1,
    brushFalloff: 0,
    ...overrides,
  };
}

function baseService() {
  const runDigNow = vi.fn(async (_ray?: THREE.Ray, _execution?: unknown) => {});
  const commitSpellTerrainEdit = vi.fn(async (): Promise<TerrainSpellEditResult> => ({
    committed: true,
    changed: false,
    converged: true,
    reason: null,
    editRevision: 1,
  }));
  const service = {
    scheduleDig: vi.fn(),
    runDigNow,
    commitSpellTerrainEdit,
    scheduleConstructionTerrainConform: vi.fn(),
    previewConstructionTerrainConform: vi.fn(),
    commitConstructionTerrainConform: vi.fn(async () => ({ committed: true, reason: null, changed: false, receipt: null })),
    undoConstructionTerrainConform: vi.fn(async () => ({ undone: true, reason: null })),
    forgetConstructionTerrainConform: vi.fn(),
    flushAncestors: vi.fn(async () => {}),
    get lastDigAt() { return 123; },
  } as unknown as TerrainEditService;
  return { service, runDigNow, commitSpellTerrainEdit };
}

function createHarness(overrides: {
  mode?: () => string;
  revision?: () => number;
  currentBrush?: () => TerrainBrushParams;
  raycast?: () => typeof hit | null;
  actor?: () => THREE.Vector3;
  allowFarCommit?: boolean;
} = {}) {
  const base = baseService();
  const terrainRaycast = {
    raycastEditableTerrain: vi.fn(overrides.raycast ?? (() => hit)),
  } as unknown as TerrainRaycastService & {
    raycastEditableTerrain: ReturnType<typeof vi.fn>;
  };
  const service = createCommandGuardedTerrainEditService(base.service, {
    terrainRaycast,
    getBrushParams: overrides.currentBrush ?? (() => brush()),
    editAuthority: {
      terrainEditRadiusM: 8,
      buildCommitRadiusM: 80,
      buildPreviewRadiusM: 160,
      allowFarPreview: true,
      allowFarCommit: overrides.allowFarCommit ?? false,
    },
    getTerrainRevision: overrides.revision ?? (() => 7),
    getInteractionMode: overrides.mode ?? (() => "playing"),
    getAuthorityOrigin: overrides.actor ?? (() => new THREE.Vector3(0, 5, 0)),
    editReadyAt: () => true,
    setLastDigSummary: vi.fn(),
    updateInfo: vi.fn(),
    nowMs: () => 100,
  });
  return { ...base, service, terrainRaycast };
}

describe("terrain edit command service", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetGameplayDiagnosticsForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetGameplayDiagnosticsForTests();
  });

  it("executes a fresh intent and honors allowFarCommit", async () => {
    const harness = createHarness({
      actor: () => new THREE.Vector3(100, 5, 100),
      allowFarCommit: true,
    });

    await harness.service.runDigNow(ray);

    expect(harness.runDigNow).toHaveBeenCalledOnce();
    expect(harness.terrainRaycast.raycastEditableTerrain).toHaveBeenCalledTimes(2);
    expect(harness.service.lastDigAt).toBe(123);
  });

  it("keeps the latest aim while the debounce timer is active", async () => {
    const harness = createHarness();

    harness.service.scheduleDig(ray);
    harness.service.scheduleDig(ray);
    harness.service.scheduleDig(ray);
    expect(harness.terrainRaycast.raycastEditableTerrain).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(40);
    await harness.service.flushAncestors();
    expect(harness.runDigNow).toHaveBeenCalledOnce();
    expect(harness.runDigNow.mock.calls[0]?.[1]).toMatchObject({
      brush: expect.objectContaining({ digRadius: 1, brushOp: "remove" }),
      targetPoint: expect.objectContaining({ x: 0, y: 5, z: 0 }),
    });
  });

  it("bounds held-input backlog to the active strike and one successor", async () => {
    let resolveFirst!: () => void;
    const first = new Promise<void>((resolve) => { resolveFirst = () => resolve(); });
    const harness = createHarness();
    harness.runDigNow.mockImplementationOnce(() => first);

    harness.service.scheduleDig(ray);
    await vi.advanceTimersByTimeAsync(40);
    expect(harness.runDigNow).toHaveBeenCalledOnce();

    harness.service.scheduleDig(ray);
    await vi.advanceTimersByTimeAsync(40);
    harness.service.scheduleDig(ray);

    resolveFirst();
    await harness.service.flushAncestors();
    expect(harness.runDigNow).toHaveBeenCalledTimes(2);
  });

  it("denies debounced intents after mode changes", async () => {
    let mode = "playing";
    const harness = createHarness({ mode: () => mode });

    harness.service.scheduleDig(ray);
    mode = "orbit";
    await vi.advanceTimersByTimeAsync(40);
    await harness.service.flushAncestors();
    expect(harness.runDigNow).not.toHaveBeenCalled();
    expect(gameplayDiagnostics.get("edit_commands_denied_mode")).toBe(1);
  });

  it("never replays a click with changed brush settings or a moved target", async () => {
    let currentBrush = brush();
    let currentHit = hit;
    const harness = createHarness({
      currentBrush: () => currentBrush,
      raycast: () => currentHit,
    });

    harness.service.scheduleDig(ray);
    currentBrush = brush({ brushOp: "add", digRadius: 4, brushMaterial: 3 });
    await vi.advanceTimersByTimeAsync(40);
    await harness.service.flushAncestors();
    expect(harness.runDigNow).not.toHaveBeenCalled();
    expect(gameplayDiagnostics.get("edits_denied_not_ready")).toBe(1);

    currentBrush = brush();
    harness.service.scheduleDig(ray);
    currentHit = { ...hit, point: new THREE.Vector3(0, 4, 0) };
    await vi.advanceTimersByTimeAsync(40);
    await harness.service.flushAncestors();
    expect(harness.runDigNow).not.toHaveBeenCalled();
    expect(gameplayDiagnostics.get("edit_commands_denied_target_moved")).toBe(1);
  });

  it("applies the frozen brush captured at intent time", async () => {
    const harness = createHarness({
      currentBrush: () => brush({ digRadius: 2, brushOp: "remove" }),
    });

    await harness.service.runDigNow(ray);

    expect(harness.runDigNow).toHaveBeenCalledOnce();
    const execution = harness.runDigNow.mock.calls[0]?.[1] as { brush?: { digRadius: number; brushOp: string } } | undefined;
    expect(execution?.brush).toMatchObject({
      digRadius: 2,
      brushOp: "remove",
    });
  });

  it("allows a pipelined successor after the prior dig bumps terrain revision", async () => {
    let revision = 7;
    const harness = createHarness({ revision: () => revision });
    harness.runDigNow.mockImplementation(async () => {
      revision += 1;
    });

    harness.service.scheduleDig(ray);
    await vi.advanceTimersByTimeAsync(40);
    harness.service.scheduleDig(ray);
    await vi.advanceTimersByTimeAsync(40);
    await harness.service.flushAncestors();

    expect(harness.runDigNow).toHaveBeenCalledTimes(2);
    expect(revision).toBe(9);
  });

  it("does not cancel remove when only the unused material selection changes", async () => {
    let currentBrush = brush({ brushMaterial: 0 });
    const harness = createHarness({ currentBrush: () => currentBrush });

    harness.service.scheduleDig(ray);
    currentBrush = brush({ brushMaterial: 4 });
    await vi.advanceTimersByTimeAsync(40);
    await harness.service.flushAncestors();

    expect(harness.runDigNow).toHaveBeenCalledOnce();
  });

  it("serializes digs behind prior world edits and validates after they complete", async () => {
    let resolveSpell!: (result: TerrainSpellEditResult) => void;
    const spellResult = new Promise<TerrainSpellEditResult>((resolve) => { resolveSpell = resolve; });
    let revision = 7;
    const harness = createHarness({ revision: () => revision });
    harness.commitSpellTerrainEdit.mockImplementationOnce(() => spellResult);

    const spell = harness.service.commitSpellTerrainEdit({ spellId: "earth" } as never);
    await Promise.resolve();
    const dig = harness.service.runDigNow(ray);
    revision = 8;
    expect(harness.runDigNow).not.toHaveBeenCalled();

    resolveSpell({ committed: true, changed: true, converged: true, reason: null, editRevision: 8 });
    await spell;
    await dig;

    expect(harness.runDigNow).not.toHaveBeenCalled();
    expect(gameplayDiagnostics.get("edit_commands_denied_revision")).toBe(1);
  });

  it("fails closed when capture or live authority dependencies are invalid", async () => {
    const captureFailure = createHarness({ currentBrush: () => { throw new Error("brush unavailable"); } });
    await captureFailure.service.runDigNow(ray);
    expect(captureFailure.runDigNow).not.toHaveBeenCalled();
    expect(gameplayDiagnostics.get("edits_denied_not_ready")).toBe(1);

    resetGameplayDiagnosticsForTests();
    const authorityFailure = createHarness({ actor: () => new THREE.Vector3(Number.NaN, 0, 0) });
    await authorityFailure.service.runDigNow(ray);
    expect(authorityFailure.runDigNow).not.toHaveBeenCalled();
    expect(gameplayDiagnostics.get("edits_denied_not_ready")).toBe(1);
  });
});
