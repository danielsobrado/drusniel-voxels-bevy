import type { PropInstance, PropPlacementScene } from "../props/prop_types.js";

export interface ProjectPropInstance {
  id: string;
  prefabId: string;
  position: [number, number, number];
  rotation: [number, number, number, number];
  scale: [number, number, number];
  anchor?: "world" | "terrain" | "voxel";
  seed?: number;
  variationId?: number;
  flags?: number;
  revision?: number;
}

export const EMPTY_PROJECT_PROPS: readonly ProjectPropInstance[] = [];

function yawToQuaternion(yaw: number): [number, number, number, number] {
  const half = yaw * 0.5;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

function quaternionToYaw(rotation: readonly number[]): number {
  const y = Number(rotation[1] ?? 0);
  const w = Number(rotation[3] ?? 1);
  return Math.atan2(2 * w * y, 1 - 2 * y * y);
}

function uniformScale(scale: readonly number[]): number {
  const x = Number(scale[0] ?? 1);
  const y = Number(scale[1] ?? x);
  const z = Number(scale[2] ?? x);
  const average = (x + y + z) / 3;
  return Number.isFinite(average) && average > 0 ? average : 1;
}

export function propPlacementSceneToProjectProps(scene: PropPlacementScene): ProjectPropInstance[] {
  return scene.instances.map((instance, index) => ({
    id: `${scene.sceneId}:${index}:${instance.assetId}`,
    prefabId: instance.assetId,
    position: [...instance.position],
    rotation: yawToQuaternion(instance.rotationY),
    scale: [instance.scale, instance.scale, instance.scale],
    anchor: "terrain",
    seed: instance.seed,
    variationId: instance.variationId,
    flags: instance.flags,
    revision: instance.revision,
  }));
}

export function projectPropsToPropPlacementScene(
  props: readonly ProjectPropInstance[],
  sceneId = "archive",
): PropPlacementScene {
  const instances: PropInstance[] = props.map((prop) => ({
    assetId: prop.prefabId,
    position: [...prop.position],
    rotationY: quaternionToYaw(prop.rotation),
    scale: uniformScale(prop.scale),
    seed: prop.seed ?? 0,
    variationId: prop.variationId ?? 0,
    flags: prop.flags ?? 0,
    revision: prop.revision ?? 0,
  }));
  return {
    schemaVersion: 1,
    sceneId,
    instances,
  };
}
