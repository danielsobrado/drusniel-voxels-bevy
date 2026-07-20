import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TerrainRaycastService } from "../../player/terrain_raycast_service.js";
import type { TerrainBrushParams, TerrainEditService, TerrainSpellEditResult } from "./terrain_edit_service.js";
import { createCommandGuardedTerrainEditService } from "./terrain_edit_command_service.js";

const RAY = new THREE.Ray(new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, -1, 0));
const HIT = { point: new THREE.Vector3(0, 5, 0), distance: 5, pageId: "page-0" };
const DEBOUNCE_MS = 40;

function createBaseService(runDigNow: ReturnType<typeof vi.fn>): TerrainEditService {
  return {
    scheduleDig: vi.fn(),
    runDigNow,
    commitSpellTerrainEdit: vi.fn(async (): Promise<TerrainSpellEditResult> => ({
      committed: true,
      changed: false,
      converged: true,
      reason: null,
      editRevision: 1,
    })),
    scheduleConstructionTerrainConform: vi.fn(),
    previewConstructionTerrainConform: vi.fn(),
    commitConstructionTerrainConform: vi.fn(async () => ({ committed: true, reason: null, changed: false, receipt: null })),
    undoConstructionTerrainConform: vi.fn(async () => ({ undone: true, reason: null })),
    forgetConstructionTerrainConform: vi.fn(),
    flushAncestors: vi.fn(async () => {}),
    get lastDigAt() { return 0; },
  } as unknown as TerrainEditService;
}

function createBrush(brushOp: TerrainBrushParams["brushOp"]): TerrainBrushParams {
  return {
    digRadius: 1,
    brushShape: "sphere",
    brushOp,
    brushMaterial: 2,
    brushHeight: 1,
    brushStrength: 1,
    brushFalloff: 0,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("terrain edit command service orbit authority", () => {
  it.each([
    ["dig", "remove"],
    ["raise", "add"],
  ] as const)("allows orbit-mode %s without a player authority origin", async (_label, brushOp) => {
    vi.useFakeTimers();
    const runDigNow = vi.fn(async () => {});
    const service = createCommandGuardedTerrainEditService(createBaseService(runDigNow), {
      terrainRaycast: {
        raycastEditableTerrain: vi.fn(() => HIT),
      } as unknown as TerrainRaycastService,
      getBrushParams: () => createBrush(brushOp),
      editAuthority: {
        terrainEditRadiusM: 8,
        buildCommitRadiusM: 80,
        buildPreviewRadiusM: 160,
        allowFarPreview: true,
        allowFarCommit: false,
      },
      getAuthorityOrigin: () => null,
      getInteractionMode: () => "orbit",
      getTerrainRevision: () => 7,
      editReadyAt: () => true,
      setLastDigSummary: vi.fn(),
      updateInfo: vi.fn(),
      nowMs: () => 100,
    });

    service.scheduleDig(RAY);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await service.flushAncestors();

    expect(runDigNow).toHaveBeenCalledOnce();
    expect(runDigNow.mock.calls[0]?.[1]).toMatchObject({
      brush: expect.objectContaining({ brushOp }),
      targetPoint: expect.objectContaining({ x: 0, y: 5, z: 0 }),
    });
  });
});
