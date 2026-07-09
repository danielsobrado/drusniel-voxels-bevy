import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  selectTreeImpostorBakeGeometry,
  TREE_IMPOSTOR_NORMAL_DEPTH_FRAGMENT_SHADER,
  TREE_IMPOSTOR_NORMAL_DEPTH_VERTEX_SHADER,
  type TreeGeometryMap,
} from "./index.js";

describe("tree impostor baker quality", () => {
  it("bakes one canonical structural variant instead of the merged selector geometry", () => {
    const merged = new THREE.BufferGeometry();
    const canonical = new THREE.BufferGeometry();
    const map = {
      oak: {
        near: merged,
        mid: merged,
        far: merged,
        impostor: merged,
        variants: {
          0: {
            near: canonical,
            mid: canonical,
            far: canonical,
            impostor: canonical,
          },
        },
      },
    } as unknown as TreeGeometryMap;

    expect(selectTreeImpostorBakeGeometry(map, "oak", "mid")).toBe(canonical);
  });

  it("stores tree-local normals, not camera-view normals", () => {
    expect(TREE_IMPOSTOR_NORMAL_DEPTH_VERTEX_SHADER).toContain("vTreeImpostorLocalNormal = normalize(normal)");
    expect(TREE_IMPOSTOR_NORMAL_DEPTH_VERTEX_SHADER).not.toContain("normalMatrix * normal");
    expect(TREE_IMPOSTOR_NORMAL_DEPTH_FRAGMENT_SHADER).toContain("vTreeImpostorLocalNormal");
  });
});
