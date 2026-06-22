/**
 * Mesh assembly for the vegetation grammar. Ported from the fable5-world-demo
 * reference (`vegetation/TubeMesh.ts` `MeshGrower`). Accumulates one indexed
 * buffer so a whole tree is 1–2 draw calls.
 *
 * The reference packs (hue, flex, phase, AO) into a `vdata` vec4 consumed by its
 * own materials. clod-poc's tree node material instead reads `color` (vec3),
 * `treeWind` (vec2 = [windWeight, flutter]) and `treeFoliageMask` (0 = bark
 * triplanar, 1 = leaf lighting), with sway phase derived per-instance from
 * `treeWorldXZ`. So this grower stores those attributes directly: hue/AO fold
 * into vertex `color` at push time, and `crownAO` darkens stored colour
 * post-hoc (there is no AO channel to scale).
 */

import * as THREE from "three";

export class VegMeshGrower {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly col: number[] = [];
  private readonly uvs: number[] = [];
  private readonly wind: number[] = [];
  private readonly mask: number[] = [];
  private readonly idx: number[] = [];
  vertCount = 0;

  vertex(
    px: number, py: number, pz: number,
    nx: number, ny: number, nz: number,
    u: number, v: number,
    r: number, g: number, b: number,
    windWeight: number, flutter: number,
    foliageMask: number,
  ): number {
    this.pos.push(px, py, pz);
    this.nrm.push(nx, ny, nz);
    this.col.push(r, g, b);
    this.uvs.push(u, v);
    this.wind.push(clamp01(windWeight), clamp01(flutter));
    this.mask.push(clamp01(foliageMask));
    return this.vertCount++;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, a, c, d);
  }

  get triCount(): number {
    return this.idx.length / 3;
  }

  /** blend normals toward a sphere around `center` (foliage cohesion trick) */
  bendNormals(center: THREE.Vector3, radius: number, k: number, fromVert = 0): void {
    const inv = 1 / Math.max(0.001, radius);
    for (let i = fromVert; i < this.vertCount; i++) {
      const px = this.pos[i * 3] as number;
      const py = this.pos[i * 3 + 1] as number;
      const pz = this.pos[i * 3 + 2] as number;
      let sx = (px - center.x) * inv;
      let sy = (py - center.y) * inv;
      let sz = (pz - center.z) * inv;
      const sl = Math.hypot(sx, sy, sz) || 1;
      sx /= sl; sy /= sl; sz /= sl;
      const nx = (this.nrm[i * 3] as number) * (1 - k) + sx * k;
      const ny = (this.nrm[i * 3 + 1] as number) * (1 - k) + sy * k;
      const nz = (this.nrm[i * 3 + 2] as number) * (1 - k) + sz * k;
      const l = Math.hypot(nx, ny, nz) || 1;
      this.nrm[i * 3] = nx / l;
      this.nrm[i * 3 + 1] = ny / l;
      this.nrm[i * 3 + 2] = nz / l;
    }
  }

  /** depth-in-crown AO: darken vertex colour for verts inside the crown hull */
  crownAO(center: THREE.Vector3, radius: number, strength: number, fromVert = 0): void {
    const inv = 1 / Math.max(0.001, radius);
    for (let i = fromVert; i < this.vertCount; i++) {
      const dx = ((this.pos[i * 3] as number) - center.x) * inv;
      const dy = ((this.pos[i * 3 + 1] as number) - center.y) * inv;
      const dz = ((this.pos[i * 3 + 2] as number) - center.z) * inv;
      const d = Math.min(1, Math.hypot(dx, dy, dz));
      const ao = 1 - strength * (1 - d) * (1 - d);
      this.col[i * 3] = (this.col[i * 3] as number) * ao;
      this.col[i * 3 + 1] = (this.col[i * 3 + 1] as number) * ao;
      this.col[i * 3 + 2] = (this.col[i * 3 + 2] as number) * ao;
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setAttribute("treeWind", new THREE.Float32BufferAttribute(this.wind, 2));
    g.setAttribute("treeFoliageMask", new THREE.Float32BufferAttribute(this.mask, 1));
    g.setIndex(
      this.vertCount > 65535
        ? new THREE.Uint32BufferAttribute(this.idx, 1)
        : new THREE.Uint16BufferAttribute(this.idx, 1),
    );
    return g;
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
