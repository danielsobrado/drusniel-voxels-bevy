import * as THREE from "three";
import { constructionMaterialLabel, createConstructionMaterial } from "./materials.js";
import { createPieceGeometry, disposeMesh } from "./construction_controller_support.js";
import type { ConstructionColliderSet } from "./construction_collider.js";
import type { ConstructionOverlapIndex } from "./overlap_index.js";
import type { ConstructionSnapIndex } from "./snap_index.js";
import type { ConstructionMaterial, ConstructionPieceDef, PlacedConstructionPiece } from "./types.js";

/** Multiplied into the albedo so an unsupported piece reads as visibly distressed. */
const UNSUPPORTED_TINT = new THREE.Color(1.0, 0.45, 0.4);

export class ConstructionPieceStore {
  readonly pieces: PlacedConstructionPiece[] = [];
  readonly meshes: THREE.Mesh[] = [];
  private readonly unsupportedOriginalColors = new Map<string, THREE.Color>();

  constructor(
    private readonly root: THREE.Group,
    private readonly piecesById: ReadonlyMap<string, ConstructionPieceDef>,
    private readonly snapIndex: ConstructionSnapIndex,
    private readonly overlapIndex: ConstructionOverlapIndex,
    private readonly colliderSet: ConstructionColliderSet | null = null,
    // Injectable because the default loads PBR textures, which needs a DOM.
    private readonly materialFactory: (material: ConstructionMaterial) => THREE.Material = createConstructionMaterial,
  ) {}

  add(placed: PlacedConstructionPiece, logPlacement: boolean): boolean {
    const piece = this.piecesById.get(placed.typeId);
    if (!piece) return false;
    const material = placed.material ?? piece.material;
    const mesh = new THREE.Mesh(createPieceGeometry(piece), this.materialFactory(material));
    mesh.name = `construction-${placed.typeId}`;
    mesh.position.set(placed.position[0], placed.position[1], placed.position[2]);
    mesh.rotation.set(0, placed.rotationQuarterTurns * Math.PI * 0.5, 0);
    this.root.add(mesh);
    mesh.updateMatrixWorld(true);
    this.meshes.push(mesh);
    this.pieces.push(placed);
    this.snapIndex.addPiece(piece, placed.id, placed.position, placed.rotationQuarterTurns);
    this.overlapIndex.addPiece(placed, piece);
    this.colliderSet?.add(placed, piece);
    if (placed.unsupported === true) this.markUnsupportedVisual(placed.id, mesh, true);
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
      this.colliderSet?.remove(placed.id);
      this.unsupportedOriginalColors.delete(placed.id);
      this.pieces.splice(index, 1);
      this.meshes.splice(index, 1);
      removed += 1;
    }
    return removed;
  }

  /**
   * Applies support flags + visual marking from a re-evaluation pass. Colliders are
   * deliberately untouched: an unsupported piece stays solid exactly where it is drawn
   * (collapse deferred means marked-not-passable, never a ghost wall).
   */
  applySupportState(groundedLost: readonly string[], groundedRestored: readonly string[], unsupportedIds: ReadonlySet<string>): void {
    const lost = new Set(groundedLost);
    const restored = new Set(groundedRestored);
    for (let index = 0; index < this.pieces.length; index += 1) {
      const placed = this.pieces[index]!;
      if (lost.has(placed.id)) placed.grounded = false;
      else if (restored.has(placed.id)) placed.grounded = true;
      const unsupported = unsupportedIds.has(placed.id);
      if (unsupported) placed.unsupported = true;
      else delete placed.unsupported;
      const mesh = this.meshes[index];
      if (mesh) this.markUnsupportedVisual(placed.id, mesh, unsupported);
    }
  }

  unsupportedCount(): number {
    return this.unsupportedOriginalColors.size;
  }

  isMarkedUnsupported(id: string): boolean {
    return this.unsupportedOriginalColors.has(id);
  }

  private markUnsupportedVisual(id: string, mesh: THREE.Mesh, unsupported: boolean): void {
    const material = mesh.material as THREE.MeshStandardMaterial;
    if (!material?.color) return;
    const original = this.unsupportedOriginalColors.get(id);
    if (unsupported && !original) {
      this.unsupportedOriginalColors.set(id, material.color.clone());
      material.color.multiply(UNSUPPORTED_TINT);
    } else if (!unsupported && original) {
      material.color.copy(original);
      this.unsupportedOriginalColors.delete(id);
    }
  }

  dispose(): void {
    for (const mesh of this.meshes) disposeMesh(mesh);
    this.meshes.length = 0;
    this.pieces.length = 0;
    this.unsupportedOriginalColors.clear();
    this.colliderSet?.dispose();
  }
}
