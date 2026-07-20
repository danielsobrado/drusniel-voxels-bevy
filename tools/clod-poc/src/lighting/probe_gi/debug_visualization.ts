import * as THREE from "three";
import { PROBE_GI_FLAGS, PROBE_GI_RECORD_BYTES } from "./constants.js";
import { readProbeGiRecord } from "./record_packing.js";
import type { ProbeGiCascadeState, ProbeGiDebugMode } from "./types.js";

const CASCADE_COLORS = [new THREE.Color(0x4bc0ff), new THREE.Color(0xffbd45), new THREE.Color(0xd06cff)] as const;

export interface ProbeGiDebugVisualization {
  readonly root: THREE.Group;
  update(cascades: readonly ProbeGiCascadeState[], mode: ProbeGiDebugMode): void;
  dispose(): void;
}

export function createProbeGiDebugVisualization(scene: THREE.Scene): ProbeGiDebugVisualization {
  const root = new THREE.Group();
  root.name = "probe-gi-debug";
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.PointsMaterial[] = [];
  const points: THREE.Points[] = [];
  scene.add(root);

  return {
    root,
    update(cascades, mode) {
      while (root.children.length) root.remove(root.children[0]);
      geometries.splice(0).forEach((geometry) => geometry.dispose());
      materials.splice(0).forEach((material) => material.dispose());
      points.length = 0;

      cascades.forEach((cascade, cascadeIndex) => {
        const count = cascade.records.byteLength / PROBE_GI_RECORD_BYTES;
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        for (let index = 0; index < count; index++) {
          const record = readProbeGiRecord(cascade, index);
          positions.set(record.positionValidity.slice(0, 3), index * 3);
          const color = debugColor(record.revisionFlags[3], record.positionValidity[3], cascadeIndex, mode);
          colors.set([color.r, color.g, color.b], index * 3);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        const material = new THREE.PointsMaterial({ size: cascade.config.spacingM * 0.08, vertexColors: true, sizeAttenuation: true });
        const cloud = new THREE.Points(geometry, material);
        cloud.name = `probe-gi-debug:${cascade.config.id}`;
        root.add(cloud);
        geometries.push(geometry);
        materials.push(material);
        points.push(cloud);
      });
    },
    dispose() {
      scene.remove(root);
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      root.clear();
    },
  };
}

function debugColor(flags: number, validity: number, cascadeIndex: number, mode: ProbeGiDebugMode): THREE.Color {
  if (mode === "validity") return validity > 0.5 ? new THREE.Color(0x55ff77) : new THREE.Color(0xff3355);
  if (mode === "relocation") return (flags & PROBE_GI_FLAGS.relocated) !== 0 ? new THREE.Color(0xffff33) : new THREE.Color(0x446688);
  if ((flags & PROBE_GI_FLAGS.terrainUnknown) !== 0) return new THREE.Color(0xff00ff);
  return CASCADE_COLORS[cascadeIndex] ?? new THREE.Color(0xffffff);
}
