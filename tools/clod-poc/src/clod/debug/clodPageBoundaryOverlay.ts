import * as THREE from "three";
import type { ClodNodeId, ClodPageNodeRuntime, ClodCut } from "../runtime/clodRuntimeTypes.js";

export class ClodPageBoundaryOverlay {
  private readonly scene: THREE.Scene;
  private boundaryGroup: THREE.Group;
  private visible = false;

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

    const indices = [0, 1, 1, 2, 2, 3, 3, 0];

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    geometry.setIndex(indices);

    const color = selected ? 0x00ff88 : 0x444488;
    const opacity = selected ? 0.8 : 0.25;
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthTest: false,
    });

    const line = new THREE.LineSegments(geometry, material);
    line.renderOrder = 20;
    this.boundaryGroup.add(line);
  }

  clear(): void {
    while (this.boundaryGroup.children.length > 0) {
      const child = this.boundaryGroup.children[0];
      if (child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
      this.boundaryGroup.remove(child);
    }
  }

  dispose(): void {
    this.clear();
    this.scene.remove(this.boundaryGroup);
  }
}
