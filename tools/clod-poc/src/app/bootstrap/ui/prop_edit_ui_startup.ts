import * as THREE from "three";
import type GUI from "lil-gui";
import { projectPropEditStore } from "../../../project/prop_edit_store.js";
import type { ProjectPropInstance } from "../../../project/project_props.js";
import type { UiStartupContext } from "../ui_startup_context.js";

const rayDirection = new THREE.Vector3();
const editRay = new THREE.Ray();

interface PropEditorState {
  enabled: boolean;
  prefabId: string;
  selectedId: string;
  x: number;
  y: number;
  z: number;
  yawDeg: number;
  scale: number;
  anchor: NonNullable<ProjectPropInstance["anchor"]>;
  count: number;
  revision: number;
  status: string;
}

function yawToQuaternion(yawDeg: number): [number, number, number, number] {
  const half = THREE.MathUtils.degToRad(yawDeg) * 0.5;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

function quaternionToYawDeg(rotation: readonly number[]): number {
  const y = Number(rotation[1] ?? 0);
  const w = Number(rotation[3] ?? 1);
  return THREE.MathUtils.radToDeg(Math.atan2(2 * w * y, 1 - 2 * y * y));
}

function uniformScale(scale: readonly number[]): number {
  const x = Number(scale[0] ?? 1);
  const y = Number(scale[1] ?? x);
  const z = Number(scale[2] ?? x);
  return Math.max(0.01, (x + y + z) / 3);
}

function applyPropToState(state: PropEditorState, prop: ProjectPropInstance): void {
  state.selectedId = prop.id;
  state.prefabId = prop.prefabId;
  state.x = prop.position[0];
  state.y = prop.position[1];
  state.z = prop.position[2];
  state.yawDeg = quaternionToYawDeg(prop.rotation);
  state.scale = uniformScale(prop.scale);
  state.anchor = prop.anchor ?? "terrain";
}

function updateStats(state: PropEditorState): void {
  state.count = projectPropEditStore.snapshot().length;
  state.revision = projectPropEditStore.revision();
}

function snapshotInput(state: PropEditorState) {
  return {
    prefabId: state.prefabId,
    position: [state.x, state.y, state.z] as [number, number, number],
    rotation: yawToQuaternion(state.yawDeg),
    scale: [state.scale, state.scale, state.scale] as [number, number, number],
    anchor: state.anchor,
  };
}

function setStatus(state: PropEditorState, message: string): void {
  state.status = message;
  updateStats(state);
}

function hitCrosshair(ctx: UiStartupContext): THREE.Vector3 | null {
  const { camera, terrainRaycast } = ctx.input;
  camera.getWorldDirection(rayDirection).normalize();
  editRay.origin.copy(camera.position);
  editRay.direction.copy(rayDirection);
  return terrainRaycast.raycastEditableTerrain(editRay)?.point ?? null;
}

export function runPropEditUiStartup(ctx: UiStartupContext, gui: GUI): void {
  const propController = ctx.input.runtime.customProps?.propController;
  const folder = gui.addFolder("Props");
  const prefabIds = propController?.availablePrefabIds() ?? [];
  const existing = projectPropEditStore.snapshot()[0];
  const state: PropEditorState = {
    enabled: propController !== undefined,
    prefabId: existing?.prefabId ?? prefabIds[0] ?? "",
    selectedId: existing?.id ?? "",
    x: existing?.position[0] ?? ctx.input.camera.position.x,
    y: existing?.position[1] ?? ctx.input.camera.position.y,
    z: existing?.position[2] ?? ctx.input.camera.position.z,
    yawDeg: existing ? quaternionToYawDeg(existing.rotation) : 0,
    scale: existing ? uniformScale(existing.scale) : 1,
    anchor: existing?.anchor ?? "terrain",
    count: projectPropEditStore.snapshot().length,
    revision: projectPropEditStore.revision(),
    status: propController ? "ready" : "disabled: start with ?propEditor=1 or ?customProps=1",
  };

  const controllers: Array<{ updateDisplay: () => unknown }> = [];
  const refresh = (): void => {
    updateStats(state);
    for (const controller of controllers) controller.updateDisplay();
  };

  const actions = {
    snapToCrosshair: () => {
      const hit = hitCrosshair(ctx);
      if (!hit) {
        setStatus(state, "no terrain hit under crosshair");
        refresh();
        return;
      }
      state.x = Number(hit.x.toFixed(3));
      state.y = Number(hit.y.toFixed(3));
      state.z = Number(hit.z.toFixed(3));
      setStatus(state, "transform snapped to crosshair");
      refresh();
    },
    addAtCrosshair: () => {
      const hit = hitCrosshair(ctx);
      if (hit) {
        state.x = Number(hit.x.toFixed(3));
        state.y = Number(hit.y.toFixed(3));
        state.z = Number(hit.z.toFixed(3));
      }
      actions.addFromFields();
    },
    addFromFields: () => {
      try {
        const prop = projectPropEditStore.add(snapshotInput(state));
        applyPropToState(state, prop);
        setStatus(state, `added ${prop.id}`);
      } catch (error) {
        setStatus(state, error instanceof Error ? error.message : String(error));
      }
      refresh();
    },
    loadSelected: () => {
      const prop = projectPropEditStore.get(state.selectedId.trim());
      if (!prop) {
        setStatus(state, "selected prop not found");
        refresh();
        return;
      }
      applyPropToState(state, prop);
      setStatus(state, `loaded ${prop.id}`);
      refresh();
    },
    selectLast: () => {
      const last = projectPropEditStore.snapshot().at(-1);
      if (!last) {
        setStatus(state, "no props to select");
        refresh();
        return;
      }
      applyPropToState(state, last);
      setStatus(state, `selected ${last.id}`);
      refresh();
    },
    updateSelected: () => {
      try {
        const prop = projectPropEditStore.update(state.selectedId.trim(), snapshotInput(state));
        applyPropToState(state, prop);
        setStatus(state, `updated ${prop.id}`);
      } catch (error) {
        setStatus(state, error instanceof Error ? error.message : String(error));
      }
      refresh();
    },
    deleteSelected: () => {
      try {
        const id = state.selectedId.trim();
        projectPropEditStore.remove(id);
        state.selectedId = "";
        setStatus(state, `deleted ${id}`);
      } catch (error) {
        setStatus(state, error instanceof Error ? error.message : String(error));
      }
      refresh();
    },
    clearAll: () => {
      projectPropEditStore.clear();
      state.selectedId = "";
      setStatus(state, "cleared all props");
      refresh();
    },
  };

  controllers.push(folder.add(state, "enabled").name("runtime ready").listen().disable());
  if (prefabIds.length > 0) controllers.push(folder.add(state, "prefabId", prefabIds).name("prefab").listen());
  else controllers.push(folder.add(state, "prefabId").name("prefab").listen());
  controllers.push(folder.add(state, "selectedId").name("selected id").listen());
  controllers.push(folder.add(state, "x", 0, ctx.input.worldCells, 0.25).name("x").listen());
  controllers.push(folder.add(state, "y", -128, 512, 0.25).name("y").listen());
  controllers.push(folder.add(state, "z", 0, ctx.input.worldCells, 0.25).name("z").listen());
  controllers.push(folder.add(state, "yawDeg", -180, 180, 1).name("yaw").listen());
  controllers.push(folder.add(state, "scale", 0.05, 20, 0.05).name("scale").listen());
  controllers.push(folder.add(state, "anchor", ["terrain", "world", "voxel"]).name("anchor").listen());
  controllers.push(folder.add(state, "count").name("count").listen().disable());
  controllers.push(folder.add(state, "revision").name("revision").listen().disable());
  controllers.push(folder.add(state, "status").name("status").listen().disable());
  folder.add(actions, "snapToCrosshair").name("Snap fields to crosshair");
  folder.add(actions, "addAtCrosshair").name("Add at crosshair");
  folder.add(actions, "addFromFields").name("Add from fields");
  folder.add(actions, "loadSelected").name("Load selected");
  folder.add(actions, "selectLast").name("Select last");
  folder.add(actions, "updateSelected").name("Update selected");
  folder.add(actions, "deleteSelected").name("Delete selected");
  folder.add(actions, "clearAll").name("Clear all props");

  projectPropEditStore.subscribe(refresh);
}
