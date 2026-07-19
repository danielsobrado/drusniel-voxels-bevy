import type { EarthSpellTarget } from "./earth_spell_vfx.js";
import type { EarthSpellGameplayConfig } from "./earth_spell_gameplay_config.js";
import { createEditCommand } from "../player/edit_commands.js";
import type {
  TerrainEditService,
  TerrainSpellEditRequest,
  TerrainSpellEditResult,
} from "../terrain/editing/terrain_edit_service.js";

export interface EarthSpellCastContext {
  terrainRevision: number;
  actor: string;
  mode: string;
  nowMs: number;
}

export interface PreparedEarthSpellCast {
  target: EarthSpellTarget;
  request: TerrainSpellEditRequest;
}

export interface ExecuteEarthSpellCastDeps {
  ready: Promise<unknown>;
  terrainEditService: Pick<TerrainEditService, "commitSpellTerrainEdit">;
  playVfx: (target: EarthSpellTarget) => boolean;
  waitForDerivedConvergence?: () => Promise<void>;
  onResult?: (result: TerrainSpellEditResult) => void;
  isDisposed?: () => boolean;
}

export function prepareEarthSpellCast(
  target: EarthSpellTarget,
  config: Readonly<EarthSpellGameplayConfig>,
  context: EarthSpellCastContext,
): PreparedEarthSpellCast | null {
  if (!config.enabled) return null;
  const point = target.point.clone();
  const normal = (target.normal ?? point.clone().set(0, 1, 0)).clone().normalize();
  const command = createEditCommand({
    operation: "spell_cast",
    targetPosition: [point.x, point.y, point.z],
    targetNormal: [normal.x, normal.y, normal.z],
    sourceTerrainRevision: context.terrainRevision,
    actor: context.actor,
    mode: context.mode,
    nowMs: context.nowMs,
    expiryMs: config.commandExpiryMs,
  });
  return {
    target: { point, normal },
    request: {
      spellId: "earth",
      command,
      edit: {
        x: point.x,
        y: point.y,
        z: point.z,
        r: config.radiusM,
        shape: config.shape,
        op: config.operation,
        material: config.operation === "add" ? config.material : undefined,
        height: config.heightM,
        strength: config.strength,
        falloff: config.falloff,
      },
    },
  };
}

export async function executePreparedEarthSpellCast(
  prepared: PreparedEarthSpellCast,
  deps: ExecuteEarthSpellCastDeps,
): Promise<TerrainSpellEditResult | null> {
  if (deps.isDisposed?.()) return null;
  const serviceResult = await deps.terrainEditService.commitSpellTerrainEdit(prepared.request, () => {
    void deps.ready.then(() => {
      if (!deps.isDisposed?.()) deps.playVfx(prepared.target);
    });
  });
  let result = serviceResult;
  if (serviceResult.committed && serviceResult.changed && serviceResult.converged && deps.waitForDerivedConvergence) {
    try {
      await deps.waitForDerivedConvergence();
    } catch (error) {
      result = {
        ...serviceResult,
        converged: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }
  deps.onResult?.(result);
  return result;
}
