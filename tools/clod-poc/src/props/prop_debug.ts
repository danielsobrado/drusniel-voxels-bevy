import * as THREE from "three";
import type { PropDebugSettings } from "./prop_types.js";
import type { PropGridCell } from "./prop_spatial_grid.js";
import { cellBoundsBox } from "./prop_culling.js";

const LOD_DEBUG_COLORS = [0x4ade80, 0x60a5fa, 0xfbbf24, 0xf87171, 0xc084fc];

export class PropDebugOverlay {
  private readonly root = new THREE.Group();
  private readonly cellGroup = new THREE.Group();
  private readonly boundsGroup = new THREE.Group();
  private cellLines: THREE.LineSegments | null = null;
  private boundHelpers: THREE.Box3Helper[] = [];

  constructor(parent: THREE.Object3D) {
    this.root.name = "custom-props-debug";
    this.cellGroup.name = "prop-cells";
    this.boundsGroup.name = "prop-bounds";
    this.root.add(this.cellGroup, this.boundsGroup);
    parent.add(this.root);
  }

  update(input: {
    settings: PropDebugSettings;
    visibleCells: PropGridCell[];
    culledCells: PropGridCell[];
    instanceBounds: { min: THREE.Vector3; max: THREE.Vector3; lod: number }[];
  }): void {
    this.clear();

    if (input.settings.showCells) {
      const positions: number[] = [];
      const pushCell = (cell: PropGridCell, color: THREE.Color) => {
        const box = cellBoundsBox(cell);
        const corners = [
          new THREE.Vector3(box.min.x, 0, box.min.z),
          new THREE.Vector3(box.max.x, 0, box.min.z),
          new THREE.Vector3(box.max.x, 0, box.max.z),
          new THREE.Vector3(box.min.x, 0, box.max.z),
        ];
        for (let i = 0; i < 4; i++) {
          const a = corners[i]!;
          const b = corners[(i + 1) % 4]!;
          positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
        void color;
      };
      for (const cell of input.visibleCells) pushCell(cell, new THREE.Color(0x22c55e));
      for (const cell of input.culledCells) pushCell(cell, new THREE.Color(0xef4444));

      if (positions.length > 0) {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        this.cellLines = new THREE.LineSegments(
          geom,
          new THREE.LineBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.65 }),
        );
        this.cellGroup.add(this.cellLines);
      }
    }

    if (input.settings.showBounds || input.settings.lodColorOverlay) {
      for (const bound of input.instanceBounds) {
        const box = new THREE.Box3(bound.min, bound.max);
        const color = input.settings.lodColorOverlay
          ? LOD_DEBUG_COLORS[Math.min(bound.lod, LOD_DEBUG_COLORS.length - 1)]!
          : 0xffffff;
        const helper = new THREE.Box3Helper(box, new THREE.Color(color));
        this.boundsGroup.add(helper);
        this.boundHelpers.push(helper);
      }
    }

    this.root.visible =
      input.settings.showCells || input.settings.showBounds || input.settings.lodColorOverlay;
  }

  dispose(): void {
    this.clear();
    this.root.removeFromParent();
  }

  private clear(): void {
    if (this.cellLines) {
      this.cellLines.geometry.dispose();
      (this.cellLines.material as THREE.Material).dispose();
      this.cellLines.removeFromParent();
      this.cellLines = null;
    }
    for (const helper of this.boundHelpers) helper.removeFromParent();
    this.boundHelpers = [];
  }
}
