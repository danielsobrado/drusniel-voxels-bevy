import * as THREE from "three";
import { buildOuterBorderLocks } from "../lock.js";
import type { ClodPageNode } from "../types.js";

export class LockedBorderOverlay {
  private readonly material = new THREE.PointsMaterial({
    color: 0xffd96a,
    size: 5,
    sizeAttenuation: false,
    depthTest: false,
    depthWrite: false,
  });
  private points: THREE.Points | null = null;

  constructor(private readonly scene: THREE.Scene) {}

  setVisible(visible: boolean): void {
    if (this.points) this.points.visible = visible;
  }

  rebuild(nodes: readonly ClodPageNode[], visible: boolean): void {
    this.disposePoints();
    // buildOuterBorderLocks scans every node's mesh; skip it entirely when the overlay is off
    // (the default). Callers re-invoke on toggle since debugKey encodes the lock flag.
    if (!visible) return;
    const positions: number[] = [];
    for (const node of nodes) {
      const locks = buildOuterBorderLocks(node.mesh);
      const pos = node.mesh.positions;
      for (let i = 0; i < locks.length; i++) {
        if (!locks[i]) continue;
        positions.push(pos[i * 3], pos[i * 3 + 1] + 0.18, pos[i * 3 + 2]);
      }
    }
    if (positions.length === 0) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
    this.points = new THREE.Points(geometry, this.material);
    this.points.visible = visible;
    this.points.renderOrder = 24;
    this.scene.add(this.points);
  }

  dispose(): void {
    this.disposePoints();
    this.material.dispose();
  }

  private disposePoints(): void {
    if (!this.points) return;
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    this.points = null;
  }
}
