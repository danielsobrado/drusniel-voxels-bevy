import * as THREE from "three";
import type { ClodNodeId, ClodPageNodeRuntime, ClodCut } from "../runtime/clodRuntimeTypes.js";

export class ClodLockedBorderOverlay {
  private readonly scene: THREE.Scene;
  private pointsGroup: THREE.Group;
  private visible = false;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.pointsGroup = new THREE.Group();
    this.pointsGroup.visible = false;
    this.scene.add(this.pointsGroup);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.pointsGroup.visible = visible;
    if (!visible) this.clear();
  }

  update(
    cut: ClodCut,
    nodes: ReadonlyMap<ClodNodeId, ClodPageNodeRuntime>,
  ): void {
    this.clear();
    if (!this.visible) return;

    const positions: number[] = [];

    for (const [nodeId] of cut.nodes) {
      const node = nodes.get(nodeId);
      if (!node || !node.lockedBorderVertexPositions) continue;

      const pos = node.lockedBorderVertexPositions;
      for (let i = 0; i < pos.length; i += 3) {
        positions.push(pos[i], pos[i + 1] + 0.3, pos[i + 2]);
      }
    }

    if (positions.length === 0) {
      const dummy = new THREE.BufferGeometry();
      dummy.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3));
      const mat = new THREE.PointsMaterial({ color: 0xffd96a, size: 5, sizeAttenuation: false, depthTest: false });
      const points = new THREE.Points(dummy, mat);
      points.visible = false;
      this.pointsGroup.add(points);
      return;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
    const material = new THREE.PointsMaterial({
      color: 0xffd96a,
      size: 6,
      sizeAttenuation: false,
      depthTest: false,
      depthWrite: false,
    });
    const points = new THREE.Points(geometry, material);
    points.renderOrder = 25;
    this.pointsGroup.add(points);
  }

  clear(): void {
    while (this.pointsGroup.children.length > 0) {
      const child = this.pointsGroup.children[0];
      if (child instanceof THREE.Points) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
      this.pointsGroup.remove(child);
    }
  }

  dispose(): void {
    this.clear();
    this.scene.remove(this.pointsGroup);
  }
}
