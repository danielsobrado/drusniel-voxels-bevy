import * as THREE from "three";
import type { ClodNodeId, ClodPageNodeRuntime, ClodCut } from "../runtime/clodRuntimeTypes.js";
import { trackedLineBasicMaterial } from "../../rendering/material_churn/tracked_material_factory.js";

export class ClodWireframeOverlay {
  private readonly scene: THREE.Scene;
  private wireframeGroup: THREE.Group;
  private visible = false;
  private lodColors: Record<string, string>;
  private readonly materials = new Map<string, THREE.LineBasicMaterial>();

  constructor(scene: THREE.Scene, lodColors: Record<string, string>) {
    this.scene = scene;
    this.wireframeGroup = new THREE.Group();
    this.wireframeGroup.visible = false;
    this.scene.add(this.wireframeGroup);
    this.lodColors = lodColors;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.wireframeGroup.visible = visible;
    if (!visible) this.clear();
  }

  update(
    cut: ClodCut,
    nodes: ReadonlyMap<ClodNodeId, ClodPageNodeRuntime>,
  ): void {
    this.clear();
    if (!this.visible) return;

    for (const [nodeId] of cut.nodes) {
      const node = nodes.get(nodeId);
      if (!node || !node.mesh) continue;

      const colorStr = this.lodColors[`lod${node.level}`] ?? "#ffffff";
      const wireframe = new THREE.WireframeGeometry(node.mesh.geometry);
      const line = new THREE.LineSegments(wireframe, this.materialFor(colorStr));
      line.position.copy(node.mesh.position);
      line.quaternion.copy(node.mesh.quaternion);
      this.wireframeGroup.add(line);
    }
  }

  clear(): void {
    while (this.wireframeGroup.children.length > 0) {
      const child = this.wireframeGroup.children[0];
      if (child instanceof THREE.LineSegments) child.geometry.dispose();
      this.wireframeGroup.remove(child);
    }
  }

  dispose(): void {
    this.clear();
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
    this.scene.remove(this.wireframeGroup);
  }

  private materialFor(color: string): THREE.LineBasicMaterial {
    const existing = this.materials.get(color);
    if (existing) return existing;
    const material = trackedLineBasicMaterial({ color: new THREE.Color(color), depthTest: true }, `clod-wireframe:${color}`);
    this.materials.set(color, material);
    return material;
  }
}
