import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  instancedDepthPrepassTwin,
  refreshInstancedDepthPrepassTwin,
  type PrepassNodes,
} from "./veg_prepass.js";

interface NodeMaterialShape {
  positionNode?: unknown;
  maskNode?: unknown;
}

describe("instanced vegetation prepass refresh", () => {
  it("removes an incompatible twin and recreates it when compatible nodes return", () => {
    const group = new THREE.Group();
    const mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial(),
      2,
    );
    group.add(mesh);

    const baseNodes = nodes("base");
    const original = instancedDepthPrepassTwin(mesh, baseNodes);
    mesh.userData.depthTwin = original;
    group.add(original);
    const dispose = vi.spyOn(original.material as THREE.Material, "dispose");

    expect(refreshInstancedDepthPrepassTwin(mesh, undefined)).toBeUndefined();
    expect(group.children).not.toContain(original);
    expect(mesh.userData.depthTwin).toBeUndefined();
    expect(mesh.userData.depthPrepassRequested).toBe(true);
    expect(dispose).toHaveBeenCalledTimes(1);

    const billboardNodes = nodes("billboard");
    const recreated = refreshInstancedDepthPrepassTwin(mesh, billboardNodes);
    const material = recreated?.material as THREE.Material & NodeMaterialShape;
    expect(recreated).toBeDefined();
    expect(group.children).toContain(recreated);
    expect(recreated?.geometry).toBe(mesh.geometry);
    expect(recreated?.instanceMatrix).toBe(mesh.instanceMatrix);
    expect(material.positionNode).toBe(billboardNodes.positionNode);
    expect(material.maskNode).toBe(billboardNodes.maskNode);

    expect(refreshInstancedDepthPrepassTwin(mesh, billboardNodes)).toBe(recreated);
  });
});

function nodes(name: string): PrepassNodes {
  return {
    positionNode: { name: `${name}-position` },
    maskNode: { name: `${name}-mask` },
    side: THREE.DoubleSide,
  };
}
