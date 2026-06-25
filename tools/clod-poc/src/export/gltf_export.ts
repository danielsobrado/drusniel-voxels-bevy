import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import type { ClodPageNode, PageMesh } from "../types.js";

const EXPORT_LOD_COLORS = [0x9ca3ad, 0x3a6ea5, 0x49a078, 0xd98032];

function exportGeometry(mesh: PageMesh): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  // GLTFExporter maps unknown attributes to an underscore-prefixed custom semantic.
  geometry.setAttribute("paintSlot", new THREE.BufferAttribute(mesh.paintSlots, 1));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  return geometry;
}

export function buildAllLodsExportScene(nodesByLevel: Map<number, ClodPageNode[]>): THREE.Scene {
  const scene = new THREE.Scene();
  scene.name = "Drusniel CLOD terrain";
  for (const [level, nodes] of [...nodesByLevel].sort(([a], [b]) => a - b)) {
    const group = new THREE.Group();
    group.name = `LOD${level}`;
    group.userData = { lodLevel: level, overlappingLodGroup: true };
    const material = new THREE.MeshStandardMaterial({
      color: EXPORT_LOD_COLORS[Math.min(level, EXPORT_LOD_COLORS.length - 1)],
      roughness: 1,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    material.name = `LOD${level} neutral`;
    for (const node of nodes) {
      const mesh = new THREE.Mesh(exportGeometry(node.mesh), material);
      mesh.name = node.id;
      mesh.userData = {
        pageId: node.id,
        lodLevel: node.level,
        footprint: node.footprint,
        errorWorld: node.errorWorld,
        lowBenefit: node.lowBenefit,
      };
      group.add(mesh);
    }
    scene.add(group);
  }
  return scene;
}

export function disposeAllLodsExportScene(scene: THREE.Scene): void {
  const materials = new Set<THREE.Material>();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    if (Array.isArray(object.material)) object.material.forEach((material) => materials.add(material));
    else materials.add(object.material);
  });
  materials.forEach((material) => material.dispose());
}

export async function exportAllLodsToGlb(nodesByLevel: Map<number, ClodPageNode[]>): Promise<Uint8Array> {
  const scene = buildAllLodsExportScene(nodesByLevel);
  try {
    const output = await new GLTFExporter().parseAsync(scene, {
      binary: true,
      onlyVisible: false,
      truncateDrawRange: false,
    });
    if (!(output instanceof ArrayBuffer)) throw new Error("GLTFExporter did not produce a binary GLB");
    return new Uint8Array(output);
  } finally {
    disposeAllLodsExportScene(scene);
  }
}
