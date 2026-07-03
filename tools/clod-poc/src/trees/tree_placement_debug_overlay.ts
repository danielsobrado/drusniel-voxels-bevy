import * as THREE from "three";
import type { TreePlacementDebugReason, TreePlacementDebugSample } from "./tree_instances.js";
import type { TreePatch } from "./tree_system_types.js";

const TREE_PLACEMENT_DEBUG_POINT_SIZE = 2.0;
const TREE_PLACEMENT_DEBUG_COLORS: Record<TreePlacementDebugReason, number> = {
  accepted: 0x33ff55,
  outside: 0xffffff,
  slope: 0xff9a22,
  height: 0x44aaff,
  material: 0xff3333,
  ecology: 0xbb55ff,
  species: 0xff55cc,
};
const TREE_PLACEMENT_DEBUG_REASONS = Object.keys(TREE_PLACEMENT_DEBUG_COLORS) as TreePlacementDebugReason[];

export class TreePlacementDebugOverlay {
  private readonly group = new THREE.Group();
  private readonly points = new Map<TreePlacementDebugReason, THREE.Points>();

  constructor(parent: THREE.Object3D) {
    this.group.name = "tree-placement-debug-overlay";
    this.group.visible = false;
    parent.add(this.group);
    for (const reason of TREE_PLACEMENT_DEBUG_REASONS) {
      const geometry = new THREE.BufferGeometry();
      const material = new THREE.PointsMaterial({
        color: TREE_PLACEMENT_DEBUG_COLORS[reason],
        size: TREE_PLACEMENT_DEBUG_POINT_SIZE,
        sizeAttenuation: true,
        depthTest: false,
        depthWrite: false,
      });
      const points = new THREE.Points(geometry, material);
      points.name = `tree-placement-debug-${reason}`;
      points.frustumCulled = false;
      this.points.set(reason, points);
      this.group.add(points);
    }
  }

  update(patches: readonly TreePatch[], enabled: boolean): void {
    this.group.visible = enabled;
    if (!enabled) {
      this.clear();
      return;
    }

    const byReason = new Map<TreePlacementDebugReason, number[]>();
    for (const reason of TREE_PLACEMENT_DEBUG_REASONS) byReason.set(reason, []);
    for (const patch of patches) {
      for (const sample of patch.generationStats.debugSamples) {
        byReason.get(sample.reason)?.push(sample.position[0], sample.position[1], sample.position[2]);
      }
    }

    for (const reason of TREE_PLACEMENT_DEBUG_REASONS) {
      this.setPositions(reason, byReason.get(reason) ?? []);
    }
  }

  clear(): void {
    for (const reason of TREE_PLACEMENT_DEBUG_REASONS) this.setPositions(reason, []);
  }

  dispose(): void {
    this.clear();
    for (const points of this.points.values()) {
      points.geometry.dispose();
      (points.material as THREE.Material).dispose();
    }
    this.group.parent?.remove(this.group);
  }

  private setPositions(reason: TreePlacementDebugReason, values: readonly number[]): void {
    const points = this.points.get(reason);
    if (!points) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(values, 3));
    points.geometry.dispose();
    points.geometry = geometry;
  }
}

export function formatTreePlacementDebugLegend(): string {
  return "placement debug: green accepted, red material, orange slope, blue height, purple ecology, pink species";
}
