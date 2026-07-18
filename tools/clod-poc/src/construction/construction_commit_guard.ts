import * as THREE from "three";
import {
  authorizeConstructionRemoval,
  createConstructionRemoveAuthorizer,
  installConstructionRemoveAuthorizer,
  type ConstructionRemoveTarget,
} from "./construction_remove_authority.js";
import { surfaceHeight } from "../terrain/terrain.js";
import { getDigEditRevision } from "../terrain/terrain_edits.js";
import {
  canCommitBuild,
  publishPlayerEditAuthorityDecision,
  type PlayerEditAuthorityConfig,
  type PlayerEditAuthorityPoint,
} from "../player/player_edit_authority.js";
import type { EditCommandDenialReason } from "../player/edit_commands.js";
import type { ConstructionPlacementConfig } from "./types.js";

const RAYCAST_REFINE_STEPS = 12;
const CONSTRUCTION_ROOT_NAME = "construction-root";
const CONSTRUCTION_GHOST_NAME = "construction-ghost";

export interface ConstructionCommitGuardDeps {
  domElement: HTMLElement;
  camera: THREE.PerspectiveCamera;
  worldCells: number;
  unboundedWorld?: boolean;
  placement: ConstructionPlacementConfig;
  editAuthority: PlayerEditAuthorityConfig;
  getAuthorityOrigin: () => PlayerEditAuthorityPoint | null;
  getCounters: () => Record<string, number> | null;
  getInteractionMode?: () => string;
  getTerrainRevision?: () => number;
  constructionReadyAt?: (x: number, z: number) => boolean;
  recordEditDenial?: (reason: EditCommandDenialReason) => void;
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

function inPlacementWorld(x: number, z: number, worldCells: number, unboundedWorld: boolean): boolean {
  return unboundedWorld || (x >= 0 && x <= worldCells && z >= 0 && z <= worldCells);
}

function raycastTerrain(
  ray: THREE.Ray,
  worldCells: number,
  placement: ConstructionPlacementConfig,
  unboundedWorld: boolean,
): THREE.Vector3 | null {
  const scratch = new THREE.Vector3();
  let previousT: number | null = null;
  let previousSigned = 0;
  for (let t = 0; t <= placement.maxRayDistanceM; t += placement.terrainStepM) {
    ray.at(t, scratch);
    if (!inPlacementWorld(scratch.x, scratch.z, worldCells, unboundedWorld)) {
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
        if (!inPlacementWorld(scratch.x, scratch.z, worldCells, unboundedWorld)) {
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

function constructionRoot(camera: THREE.Camera): THREE.Object3D | null {
  let root: THREE.Object3D = camera;
  while (root.parent) root = root.parent;
  return root.getObjectByName(CONSTRUCTION_ROOT_NAME) ?? null;
}

function raycastConstructionTarget(ray: THREE.Ray, camera: THREE.Camera): ConstructionRemoveTarget | null {
  const root = constructionRoot(camera);
  if (!root) return null;
  root.updateMatrixWorld(true);
  const meshes = root.children.filter((child): child is THREE.Mesh => (
    child instanceof THREE.Mesh && child.name !== CONSTRUCTION_GHOST_NAME
  ));
  if (meshes.length === 0) return null;
  const raycaster = new THREE.Raycaster();
  raycaster.ray.copy(ray);
  const hit = raycaster.intersectObjects(meshes, false)[0];
  if (!hit) return null;
  const position = hit.object.getWorldPosition(new THREE.Vector3());
  return {
    id: hit.object.uuid,
    position: [position.x, position.y, position.z],
  };
}

function rejectPointerEvent(event: PointerEvent): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

export function installConstructionCommitGuard(deps: ConstructionCommitGuardDeps): () => void {
  const disposeRemoveAuthorizer = installConstructionRemoveAuthorizer(createConstructionRemoveAuthorizer({
    getActorPosition: deps.getAuthorityOrigin,
    getCurrentMode: deps.getInteractionMode ?? (() => "playing"),
    getTerrainRevision: deps.getTerrainRevision ?? getDigEditRevision,
    getMaxDistanceM: () => deps.editAuthority.allowFarCommit
      ? Number.MAX_SAFE_INTEGER
      : deps.editAuthority.buildCommitRadiusM,
    targetReadyAt: deps.constructionReadyAt,
    onDenied: (reason) => deps.recordEditDenial?.(reason),
  }));

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button === 2) {
      const ray = pointerRay(event, deps.domElement, deps.camera);
      const target = ray ? raycastConstructionTarget(ray, deps.camera) : null;
      if (!target) return;
      const verdict = authorizeConstructionRemoval(target);
      if (verdict.allowed) return;
      rejectPointerEvent(event);
      deps.onRejected?.(`construction removal denied: ${verdict.reason}`);
      return;
    }

    if (event.button !== 0) return;
    const origin = deps.getAuthorityOrigin();
    if (!origin || deps.editAuthority.allowFarCommit) return;
    const ray = pointerRay(event, deps.domElement, deps.camera);
    if (!ray) return;
    const hit = raycastTerrain(ray, deps.worldCells, deps.placement, deps.unboundedWorld ?? false);
    if (!hit) return;
    const decision = canCommitBuild(deps.editAuthority, origin, hit);
    publishPlayerEditAuthorityDecision(deps.getCounters(), decision);
    if (decision.allowed) return;
    rejectPointerEvent(event);
    deps.onRejected?.(decision.reason ?? "build target is outside commit range");
  };
  deps.domElement.addEventListener("pointerdown", onPointerDown, { capture: true });
  return () => {
    deps.domElement.removeEventListener("pointerdown", onPointerDown, { capture: true });
    disposeRemoveAuthorizer();
  };
}
