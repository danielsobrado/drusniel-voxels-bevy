import * as THREE from "three";
import { constructionMaterialLabel, createConstructionMaterial } from "./materials.js";
import { createPieceGeometry, disposeMesh } from "./construction_controller_support.js";
import type { ConstructionOverlapIndex } from "./overlap_index.js";
import type { ConstructionSnapIndex } from "./snap_index.js";
import type { ConstructionPieceDef, PlacedConstructionPiece } from "./types.js";

export class ConstructionPieceStore {
  readonly pieces: PlacedConstructionPiece[] = [];
  readonly meshes: THREE.Mesh[] = [];

  constructor(
    private readonly root: THREE.Group,
    private readonly piecesById: ReadonlyMap<string, ConstructionPieceDef>,
    private readonly snapIndex: ConstructionSnapIndex,
    private readonly overlapIndex: ConstructionOverlapIndex,
  ) {}

  add(placed: PlacedConstructionPiece, logPlacement: boolean): boolean {
    const piece = this.piecesById.get(placed.typeId);
    if (!piece) return false;
    const material = placed.material ?? piece.material;
    const mesh = new THREE.Mesh(createPieceGeometry(piece), createConstructionMaterial(material));
    mesh.name = `construction-${placed.typeId}`;
    mesh.position.set(placed.position[0], placed.position[1], placed.position[2]);
    mesh.rotation.set(0, placed.rotationQuarterTurns * Math.PI * 0.5, 0);
    this.root.add(mesh);
    mesh.updateMatrixWorld(true);
    this.meshes.push(mesh);
    this.pieces.push(placed);
    this.snapIndex.addPiece(piece, placed.id, placed.position, placed.rotationQuarterTurns);
    this.overlapIndex.addPiece(placed, piece);
    if (logPlacement) {
      console.info(`[construction] placed ${piece.label} (${constructionMaterialLabel(material)}) at ${placed.position.map((value) => value.toFixed(2)).join(", ")}`);
    }
    return true;
  }

  collectDependentIds(rootId: string): Set<string> {
    const result = new Set<string>([rootId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const placed of this.pieces) {
        if (result.has(placed.id)) continue;
        if ((placed.parentIds ?? []).some((parentId) => result.has(parentId))) {
          result.add(placed.id);
          changed = true;
        }
      }
    }
    return result;
  }

  removeByIds(ids: ReadonlySet<string>): number {
    let removed = 0;
    for (let index = this.pieces.length - 1; index >= 0; index -= 1) {
      const placed = this.pieces[index]!;
      if (!ids.has(placed.id)) continue;
      const mesh = this.meshes[index];
      if (mesh) {
        this.root.remove(mesh);
        disposeMesh(mesh);
      }
      this.snapIndex.removeEntity(placed.id);
      this.overlapIndex.removeEntity(placed.id);
      this.pieces.splice(index, 1);
      this.meshes.splice(index, 1);
      removed += 1;
    }
    return removed;
  }

  dispose(): void {
    for (const mesh of this.meshes) disposeMesh(mesh);
    this.meshes.length = 0;
    this.pieces.length = 0;
  }
}
