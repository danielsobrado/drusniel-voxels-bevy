import * as THREE from "three";
import type { ClodNodeId, ClodPageNodeRuntime, ClodCut } from "../runtime/clodRuntimeTypes.js";

export class ClodWireframeOverlay {
  private readonly scene: THREE.Scene;
  private wireframeGroup: THREE.Group;
  private visible = false;
  private lodColors: Record<string, string>;

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
      const color = new THREE.Color(colorStr);

      const wireframe = new THREE.WireframeGeometry(node.mesh.geometry);
      const material = new THREE.LineBasicMaterial({ color, depthTest: true });
      const line = new THREE.LineSegments(wireframe, material);
      line.position.copy(node.mesh.position);
      line.quaternion.copy(node.mesh.quaternion);
      this.wireframeGroup.add(line);
    }
  }

  clear(): void {
    while (this.wireframeGroup.children.length > 0) {
      const child = this.wireframeGroup.children[0];
      if (child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
      this.wireframeGroup.remove(child);
    }
  }

  dispose(): void {
    this.clear();
    this.scene.remove(this.wireframeGroup);
  }
}
