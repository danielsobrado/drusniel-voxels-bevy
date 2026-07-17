import * as THREE from "three";
import { constructionMaterialLabel, createConstructionMaterial } from "./materials.js";
import { createPieceGeometry, disposeMesh } from "./construction_controller_support.js";
import type { ConstructionColliderSet } from "./construction_collider.js";
import type { ConstructionOverlapIndex } from "./overlap_index.js";
import type { ConstructionSnapIndex } from "./snap_index.js";
import type { ConstructionMaterial, ConstructionPieceDef, PlacedConstructionPiece } from "./types.js";

/** Multiplied into the albedo so an unsupported piece reads as visibly distressed. */
const UNSUPPORTED_TINT = new THREE.Color(1.0, 0.45, 0.4);

function clonePlacedPiece(placed: PlacedConstructionPiece): PlacedConstructionPiece {
  return {
    ...placed,
    position: [placed.position[0], placed.position[1], placed.position[2]],
    parentIds: placed.parentIds ? [...placed.parentIds] : undefined,
  };
}

export class ConstructionPieceStore {
  readonly pieces: PlacedConstructionPiece[] = [];
  readonly meshes: THREE.Mesh[] = [];
  private readonly pieceIds = new Set<string>();
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
    if (!piece || this.pieceIds.has(placed.id)) return false;

    const stored = clonePlacedPiece(placed);
    const material = stored.material ?? piece.material;
    const geometry = createPieceGeometry(piece);
    let pieceMaterial: THREE.Material;
    try {
      pieceMaterial = this.materialFactory(material);
    } catch (error) {
      geometry.dispose();
      throw error;
    }
    const mesh = new THREE.Mesh(geometry, pieceMaterial);
    mesh.name = `construction-${stored.typeId}`;
    mesh.position.set(stored.position[0], stored.position[1], stored.position[2]);
    mesh.rotation.set(0, stored.rotationQuarterTurns * Math.PI * 0.5, 0);
    mesh.updateMatrixWorld(true);

    try {
      this.snapIndex.addPiece(piece, stored.id, stored.position, stored.rotationQuarterTurns);
      this.overlapIndex.addPiece(stored, piece);
      this.colliderSet?.add(stored, piece);
      this.root.add(mesh);
      this.meshes.push(mesh);
      this.pieces.push(stored);
      this.pieceIds.add(stored.id);
      if (stored.unsupported === true) this.markUnsupportedVisual(stored.id, mesh, true);
    } catch (error) {
      this.colliderSet?.remove(stored.id);
      this.overlapIndex.removeEntity(stored.id);
      this.snapIndex.removeEntity(stored.id);
      this.root.remove(mesh);
      disposeMesh(mesh);
      throw error;
    }

    if (logPlacement) {
      console.info(`[construction] placed ${piece.label} (${constructionMaterialLabel(material)}) at ${stored.position.map((value) => value.toFixed(2)).join(", ")}`);
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
      this.pieceIds.delete(placed.id);
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
    for (let index = 0; index < this.meshes.length; index += 1) {
      const placed = this.pieces[index];
      if (placed) {
        this.snapIndex.removeEntity(placed.id);
        this.overlapIndex.removeEntity(placed.id);
      }
      const mesh = this.meshes[index]!;
      this.root.remove(mesh);
      disposeMesh(mesh);
    }
    this.meshes.length = 0;
    this.pieces.length = 0;
    this.pieceIds.clear();
    this.unsupportedOriginalColors.clear();
    this.colliderSet?.dispose();
  }
}
