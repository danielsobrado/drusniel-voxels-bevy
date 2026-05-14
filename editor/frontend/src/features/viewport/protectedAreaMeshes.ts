import * as THREE from "three";
import type { ProtectedArea } from "../../types/world";

export interface LiteProtectedAreaOverlay {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly bounds: ProtectedArea["bounds"];
  readonly kind: "selected" | "warning" | "agent" | "default";
}

export const boundsCenter = (bounds: ProtectedArea["bounds"]) =>
  new THREE.Vector3(
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  );

export const boundsSize = (bounds: ProtectedArea["bounds"]) =>
  new THREE.Vector3(
    Math.max(0.1, bounds.max[0] - bounds.min[0]),
    Math.max(0.1, bounds.max[1] - bounds.min[1]),
    Math.max(0.1, bounds.max[2] - bounds.min[2]),
  );

export const overlayColor = (area: LiteProtectedAreaOverlay) => {
  if (area.kind === "selected") {
    return "#2cb8ff";
  }

  if (area.kind === "warning") {
    return "#f5a524";
  }

  if (area.kind === "agent") {
    return "#a26cff";
  }

  return area.color || "#8f95a3";
};
