import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  gameplayDiagnostics,
  resetGameplayDiagnosticsForTests,
} from "../../player/gameplay_diagnostics.js";
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
  const runDigNow = vi.fn(async () => undefined);
  const commitSpellTerrainEdit = vi.fn(async (): Promise<TerrainSpellEditResult> => ({
    committed: true,
    changed: false,
    converged: true,
    reason: null,
    editRevision: 1,
  }));
  const flushAncestors = vi.fn(async () => undefined);
  const service = {
    scheduleDig: vi.fn(),
    runDigNow,
    commitSpellTerrainEdit,
    scheduleConstructionTerrainConform: vi.fn(),
    previewConstructionTerrainConform: vi.fn(),
    commitConstructionTerrainConform: vi.fn(async () => ({ committed: true, reason: null, changed: false, receipt: null })),
    undoConstructionTerrainConform: vi.fn(async () => ({ undone: true, reason: null })),
    forgetConstructionTerrainConform: vi.fn(),
    flushAncestors,
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
  const terrainRaycast = { raycastEditableTerrain: vi.fn(overrides.raycast ?? (() => hit)) } as never;
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

  it("denies debounced intents after mode or terrain revision changes", async () => {
    let mode = "playing";
    let revision = 7;
    const harness = createHarness({ mode: () => mode, revision: () => revision });

    harness.service.scheduleDig(ray);
    mode = "orbit";
    await vi.advanceTimersByTimeAsync(40);
    await harness.service.flushAncestors();
    expect(harness.runDigNow).not.toHaveBeenCalled();
    expect(gameplayDiagnostics.get("edit_commands_denied_mode")).toBe(1);

    mode = "playing";
    harness.service.scheduleDig(ray);
    revision = 8;
    await vi.advanceTimersByTimeAsync(40);
    await harness.service.flushAncestors();
    expect(harness.runDigNow).not.toHaveBeenCalled();
    expect(gameplayDiagnostics.get("edit_commands_denied_revision")).toBe(1);
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

    currentBrush = brush();
    harness.service.scheduleDig(ray);
    currentHit = { ...hit, point: new THREE.Vector3(0, 4, 0) };
    await vi.advanceTimersByTimeAsync(40);
    await harness.service.flushAncestors();
    expect(harness.runDigNow).not.toHaveBeenCalled();
    expect(gameplayDiagnostics.get("edit_commands_denied_target_moved")).toBe(2);
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
});
