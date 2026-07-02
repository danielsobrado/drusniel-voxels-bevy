import * as THREE from "three";
import type { ClodNodeId, ClodPageNodeRuntime, ClodCut } from "../runtime/clodRuntimeTypes.js";
import { trackedLineBasicMaterial } from "../../rendering/material_churn/tracked_material_factory.js";

export class ClodPageBoundaryOverlay {
  private readonly scene: THREE.Scene;
  private boundaryGroup: THREE.Group;
  private visible = false;
  private readonly selectedMaterial = trackedLineBasicMaterial({
    color: 0x00ff88,
    transparent: true,
    opacity: 0.8,
    depthTest: false,
  }, "clod-page-boundary:selected");
  private readonly faintMaterial = trackedLineBasicMaterial({
    color: 0x444488,
    transparent: true,
    opacity: 0.25,
    depthTest: false,
  }, "clod-page-boundary:faint");

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.boundaryGroup = new THREE.Group();
    this.boundaryGroup.visible = false;
    this.scene.add(this.boundaryGroup);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.boundaryGroup.visible = visible;
    if (!visible) this.clear();
  }

  update(
    cut: ClodCut,
    nodes: ReadonlyMap<ClodNodeId, ClodPageNodeRuntime>,
    renderAllFaint = false,
  ): void {
    this.clear();
    if (!this.visible) return;

    const selectedIds = new Set(cut.nodes.keys());

    if (renderAllFaint) {
      for (const [nodeId, node] of nodes) {
        this.addFootprintRect(node, selectedIds.has(nodeId));
      }
    } else {
      for (const [nodeId] of cut.nodes) {
        const node = nodes.get(nodeId);
        if (node) this.addFootprintRect(node, true);
      }
    }
  }

  private addFootprintRect(node: ClodPageNodeRuntime, selected: boolean): void {
    const f = node.footprint;
    const minX = f.minX;
    const minZ = f.minZ;
    const maxX = f.maxX;
    const maxZ = f.maxZ;
    const y = node.minY;

    const vertices = new Float32Array([
      minX, y, minZ,
      maxX, y, minZ,
      maxX, y, maxZ,
      minX, y, maxZ,
    ]);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    geometry.setIndex([0, 1, 1, 2, 2, 3, 3, 0]);

    const line = new THREE.LineSegments(geometry, selected ? this.selectedMaterial : this.faintMaterial);
    line.renderOrder = 20;
    this.boundaryGroup.add(line);
  }

  clear(): void {
    while (this.boundaryGroup.children.length > 0) {
      const child = this.boundaryGroup.children[0];
      if (child instanceof THREE.LineSegments) child.geometry.dispose();
      this.boundaryGroup.remove(child);
    }
  }

  dispose(): void {
    this.clear();
    this.selectedMaterial.dispose();
    this.faintMaterial.dispose();
    this.scene.remove(this.boundaryGroup);
  }
}
