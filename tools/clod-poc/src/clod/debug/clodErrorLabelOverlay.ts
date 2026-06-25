import * as THREE from "three";
import type { ClodNodeId, ClodPageNodeRuntime, ClodCut } from "../runtime/clodRuntimeTypes.js";
import { computeNodeErrorPx, computeNodeDistanceToCamera } from "../runtime/clodError.js";

const MAX_LABELS = 64;

interface LabelElement {
  div: HTMLDivElement;
  nodeId: string;
}

export class ClodErrorLabelOverlay {
  private readonly container: HTMLElement;
  private labels: LabelElement[] = [];
  private visible = false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.classList.add("clod-error-label-layer");
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.container.hidden = !visible;
  }

  update(
    cut: ClodCut,
    nodes: ReadonlyMap<ClodNodeId, ClodPageNodeRuntime>,
    camera: THREE.PerspectiveCamera,
    viewportHeightPx: number,
  ): void {
    if (!this.visible) return;

    const selected = [...cut.nodes.values()].slice(0, MAX_LABELS);
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    const fovY = THREE.MathUtils.degToRad(camera.fov);
    const scratch = new THREE.Vector3();

    this.ensureLabelCount(selected.length);

    for (let i = 0; i < this.labels.length; i++) {
      const label = this.labels[i];
      const sel = selected[i];

      if (!sel) {
        label.div.hidden = true;
        continue;
      }

      const node = nodes.get(sel.nodeId);
      if (!node) {
        label.div.hidden = true;
        continue;
      }

      scratch.fromArray(node.boundingSphere.center);
      const worldPos = scratch.clone();
      const dist = computeNodeDistanceToCamera(node, camera);
      const errorPx = computeNodeErrorPx(node, camera, viewportHeightPx, fovY);

      worldPos.project(camera);
      const camSpace = new THREE.Vector3().copy(scratch).applyMatrix4(camera.matrixWorldInverse);
      const isVisible = camSpace.z < 0 && worldPos.z >= -1 && worldPos.z <= 1 &&
        worldPos.x >= -1 && worldPos.x <= 1 && worldPos.y >= -1 && worldPos.y <= 1;

      label.div.hidden = !isVisible;
      if (!isVisible) continue;

      if (label.nodeId !== sel.nodeId) {
        label.nodeId = sel.nodeId;
        label.div.dataset.level = String(sel.level);
      }

      const x = (worldPos.x * 0.5 + 0.5) * width;
      const y = (-worldPos.y * 0.5 + 0.5) * height;
      label.div.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      label.div.innerHTML = `
        <strong>${sel.nodeId}</strong>
        <span>L${sel.level} · ${node.footprint.minX},${node.footprint.minZ}-${node.footprint.maxX},${node.footprint.maxZ}</span>
        <span>err_w ${node.errorWorld.toFixed(3)} · err_px ${errorPx.toFixed(2)} · dist ${dist.toFixed(1)}</span>
        <span>reason: ${sel.reason}${node.lowBenefit ? " · LOW BENEFIT" : ""}</span>
      `;
    }
  }

  private ensureLabelCount(count: number): void {
    while (this.labels.length < count) {
      const div = document.createElement("div");
      div.className = "clod-error-label";
      this.container.appendChild(div);
      this.labels.push({ div, nodeId: "" });
    }
    for (let i = count; i < this.labels.length; i++) {
      this.labels[i].div.hidden = true;
    }
  }
}
