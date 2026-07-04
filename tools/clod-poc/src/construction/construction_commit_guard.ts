import * as THREE from "three";
import { surfaceHeight } from "../terrain/terrain.js";
import {
  canCommitBuild,
  publishPlayerEditAuthorityDecision,
  type PlayerEditAuthorityConfig,
  type PlayerEditAuthorityPoint,
} from "../player/player_edit_authority.js";
import type { ConstructionPlacementConfig } from "./types.js";

const RAYCAST_REFINE_STEPS = 12;

export interface ConstructionCommitGuardDeps {
  domElement: HTMLElement;
  camera: THREE.PerspectiveCamera;
  worldCells: number;
  placement: ConstructionPlacementConfig;
  editAuthority: PlayerEditAuthorityConfig;
  getAuthorityOrigin: () => PlayerEditAuthorityPoint | null;
  getCounters: () => Record<string, number> | null;
  onRejected?: (reason: string) => void;
}

function pointerRay(event: PointerEvent, domElement: HTMLElement, camera: THREE.PerspectiveCamera): THREE.Ray | null {
  const rect = domElement.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const ndc = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray.clone();
}

function raycastTerrain(ray: THREE.Ray, worldCells: number, placement: ConstructionPlacementConfig): THREE.Vector3 | null {
  const scratch = new THREE.Vector3();
  let previousT: number | null = null;
  let previousSigned = 0;
  for (let t = 0; t <= placement.maxRayDistanceM; t += placement.terrainStepM) {
    ray.at(t, scratch);
    const inWorld = scratch.x >= 0 && scratch.x <= worldCells && scratch.z >= 0 && scratch.z <= worldCells;
    if (!inWorld) {
      previousT = null;
      continue;
    }
    const signed = scratch.y - surfaceHeight(scratch.x, scratch.z);
    if (previousT !== null && previousSigned >= 0 && signed <= 0) {
      let lo = previousT;
      let hi = t;
      for (let i = 0; i < RAYCAST_REFINE_STEPS; i += 1) {
        const mid = (lo + hi) * 0.5;
        ray.at(mid, scratch);
        const midInWorld = scratch.x >= 0 && scratch.x <= worldCells && scratch.z >= 0 && scratch.z <= worldCells;
        if (!midInWorld) {
          lo = mid;
          continue;
        }
        const midSigned = scratch.y - surfaceHeight(scratch.x, scratch.z);
        if (midSigned > 0) lo = mid;
        else hi = mid;
      }
      ray.at(hi, scratch);
      return scratch.clone();
    }
    previousT = t;
    previousSigned = signed;
  }
  return null;
}

export function installConstructionCommitGuard(deps: ConstructionCommitGuardDeps): () => void {
  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const origin = deps.getAuthorityOrigin();
    if (!origin || deps.editAuthority.allowFarCommit) return;
    const ray = pointerRay(event, deps.domElement, deps.camera);
    if (!ray) return;
    const hit = raycastTerrain(ray, deps.worldCells, deps.placement);
    if (!hit) return;
    const decision = canCommitBuild(deps.editAuthority, origin, hit);
    publishPlayerEditAuthorityDecision(deps.getCounters(), decision);
    if (decision.allowed) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    deps.onRejected?.(decision.reason ?? "build target is outside commit range");
  };
  deps.domElement.addEventListener("pointerdown", onPointerDown, { capture: true });
  return () => deps.domElement.removeEventListener("pointerdown", onPointerDown, { capture: true });
}
