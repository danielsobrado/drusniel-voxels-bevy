import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  instancedDepthPrepassTwin,
  refreshInstancedDepthPrepassTwin,
  type PrepassNodes,
} from "./veg_prepass.js";

describe("instanced depth-prepass twin disposal", () => {
  it("disposes twin mesh state when prepass is disabled", () => {
    const { group, mesh, twin } = fixture(nodes("base"));
    const twinDispose = vi.spyOn(twin, "dispose");
    const materialDispose = vi.spyOn(twin.material as THREE.Material, "dispose");
    const geometryDispose = vi.spyOn(mesh.geometry, "dispose");

    expect(refreshInstancedDepthPrepassTwin(mesh, undefined)).toBeUndefined();

    expect(group.children).not.toContain(twin);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(twinDispose).toHaveBeenCalledTimes(1);
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(twin.instanceMatrix).toBe(mesh.instanceMatrix);
  });

  it("disposes replaced twin mesh state without releasing shared attributes", () => {
    const { group, mesh, twin } = fixture(nodes("base"));
    const twinDispose = vi.spyOn(twin, "dispose");
    const materialDispose = vi.spyOn(twin.material as THREE.Material, "dispose");
    const geometryDispose = vi.spyOn(mesh.geometry, "dispose");
    const nextNodes = nodes("billboard");

    const replacement = refreshInstancedDepthPrepassTwin(mesh, nextNodes);

    expect(replacement).toBeDefined();
    expect(replacement).not.toBe(twin);
    expect(group.children).not.toContain(twin);
    expect(group.children).toContain(replacement);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(twinDispose).toHaveBeenCalledTimes(1);
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(replacement?.geometry).toBe(mesh.geometry);
    expect(replacement?.instanceMatrix).toBe(mesh.instanceMatrix);
  });
});

function fixture(prepassNodes: PrepassNodes): {
  group: THREE.Group;
  mesh: THREE.InstancedMesh;
  twin: THREE.InstancedMesh;
} {
  const group = new THREE.Group();
  const mesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial(),
    2,
  );
  group.add(mesh);
  const twin = instancedDepthPrepassTwin(mesh, prepassNodes);
  mesh.userData.depthTwin = twin;
  group.add(twin);
  return { group, mesh, twin };
}

function nodes(name: string): PrepassNodes {
  return {
    positionNode: { name: `${name}-position` },
    maskNode: { name: `${name}-mask` },
    side: THREE.DoubleSide,
  };
}
