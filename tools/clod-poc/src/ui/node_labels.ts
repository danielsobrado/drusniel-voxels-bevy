import * as THREE from "three";
import type { ClodPageNode } from "../types.js";

export const MAX_NODE_LABELS = 64;

interface LabelRecord {
  element: HTMLElement;
  nodeId: string;
}

export interface NodeLabelUpdate {
  nodes: readonly ClodPageNode[];
  camera: THREE.Camera;
  viewport: HTMLElement;
  viewportHeight: number;
  fovY: number;
}

export class NodeLabelOverlay {
  private readonly labels: LabelRecord[] = [];
  private readonly scratch = new THREE.Vector3();
  private readonly cameraSpace = new THREE.Vector3();

  constructor(private readonly root: HTMLElement) {
    root.classList.add("clod-node-label-layer");
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  update({ nodes, camera, viewport, viewportHeight, fovY }: NodeLabelUpdate): void {
    if (this.root.hidden) return;
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    const cameraPosition = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    const limited = nodes.slice(0, MAX_NODE_LABELS);
    this.ensureLabelCount(limited.length);

    for (let i = 0; i < this.labels.length; i++) {
      const label = this.labels[i];
      const node = limited[i];
      if (!node) {
        label.element.hidden = true;
        continue;
      }

      this.scratch.fromArray(node.bounds.center);
      this.cameraSpace.copy(this.scratch).applyMatrix4(camera.matrixWorldInverse);
      const dist = Math.max(0.001, this.scratch.distanceTo(cameraPosition) - node.bounds.radius);
      const errorPx = (node.errorWorld * viewportHeight) / (2 * dist * Math.tan(fovY / 2));
      this.scratch.project(camera);
      const visible =
        this.cameraSpace.z < 0 &&
        this.scratch.z >= -1 &&
        this.scratch.z <= 1 &&
        this.scratch.x >= -1 &&
        this.scratch.x <= 1 &&
        this.scratch.y >= -1 &&
        this.scratch.y <= 1;
      label.element.hidden = !visible;
      if (!visible) continue;

      if (label.nodeId !== node.id) {
        label.nodeId = node.id;
        label.element.dataset.level = String(node.level);
      }
      const x = (this.scratch.x * 0.5 + 0.5) * width;
      const y = (-this.scratch.y * 0.5 + 0.5) * height;
      label.element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      label.element.innerHTML = `
        <strong>${node.id}</strong>
        <span>L${node.level} · ${shortFootprint(node)}</span>
        <span>err ${node.errorWorld.toFixed(3)}w · ${errorPx.toFixed(2)}px</span>
      `;
    }
  }

  private ensureLabelCount(count: number): void {
    while (this.labels.length < count) {
      const element = document.createElement("div");
      element.className = "clod-node-label";
      this.root.appendChild(element);
      this.labels.push({ element, nodeId: "" });
    }
    for (let i = count; i < this.labels.length; i++) {
      this.labels[i].element.hidden = true;
    }
  }
}

function shortFootprint(node: ClodPageNode): string {
  const { minX, minZ, maxX, maxZ } = node.footprint;
  return `${minX},${minZ}-${maxX},${maxZ}`;
}
