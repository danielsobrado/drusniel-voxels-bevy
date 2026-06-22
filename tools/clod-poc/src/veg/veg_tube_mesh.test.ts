import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { VegMeshGrower } from "./veg_mesh_grower.js";
import { ringsForLevel, tubeForBranch } from "./veg_tube_mesh.js";
import { Rng } from "./veg_rng.js";
import type { SkelBranch } from "./veg_types.js";

function straightBranch(segs: number, len: number, baseR: number): SkelBranch {
  const pts: THREE.Vector3[] = [];
  const radii: number[] = [];
  const dirs: THREE.Vector3[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    pts.push(new THREE.Vector3(0, t * len, 0));
    radii.push(Math.max(0.01, baseR * (1 - t)));
    dirs.push(new THREE.Vector3(0, 1, 0));
  }
  return { level: 0, pts, radii, dirs, len, tParent: 0, broken: false };
}

describe("veg tube mesh", () => {
  it("builds a closed tapered tube with the clod-poc attribute contract", () => {
    const g = new VegMeshGrower();
    const segs = 4;
    const ringSegs = 6;
    tubeForBranch(
      g,
      straightBranch(segs, 5, 0.3),
      { ringSegs, uRepeats: 2, vScale: 1, swayFlexBase: 0, swayFlexTip: 0.05, color: new THREE.Color(0x5b3a22) },
      new Rng(1),
    );
    const n = segs + 1;
    // n rings of (ringSegs+1) verts, plus one tip vertex (non-broken taper)
    expect(g.vertCount).toBe(n * (ringSegs + 1) + 1);
    // walls: (n-1)*ringSegs quads (×2 tris) + ringSegs tip tris
    expect(g.triCount).toBe((n - 1) * ringSegs * 2 + ringSegs);

    const geo = g.build();
    expect(geo.getAttribute("position").count).toBe(g.vertCount);
    expect(geo.getAttribute("treeWind").itemSize).toBe(2);
    const mask = geo.getAttribute("treeFoliageMask");
    for (let i = 0; i < mask.count; i++) expect(mask.getX(i)).toBe(0); // all bark
    expect(geo.getIndex()).toBeTruthy();
  });

  it("bendNormals pushes normals toward the crown sphere", () => {
    const g = new VegMeshGrower();
    // a vertex at +x with a normal pointing −x; bending toward center should flip it outward
    g.vertex(1, 0, 0, -1, 0, 0, 0, 0, 1, 1, 1, 0, 0, 1);
    g.bendNormals(new THREE.Vector3(0, 0, 0), 1, 1);
    const nrm = g.build().getAttribute("normal");
    expect(nrm.getX(0)).toBeCloseTo(1, 5); // now points +x (away from center)
  });

  it("crownAO darkens interior vertex colours", () => {
    const g = new VegMeshGrower();
    g.vertex(0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0.5, 0, 1); // at center → darkest
    g.crownAO(new THREE.Vector3(0, 0, 0), 1, 0.55);
    const col = g.build().getAttribute("color");
    expect(col.getX(0)).toBeCloseTo(1 - 0.55, 5);
  });

  it("ringsForLevel reduces with lod and floors at 4", () => {
    expect(ringsForLevel(0, 1)).toBe(14);
    expect(ringsForLevel(2, 0.1)).toBe(4);
  });
});
