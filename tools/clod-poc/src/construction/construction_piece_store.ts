import * as THREE from "three";
import { constructionMaterialLabel, createConstructionMaterial } from "./materials.js";
import { createPieceGeometry, disposeMesh } from "./construction_controller_support.js";
import { constructionStabilityColorHex } from "./construction_stability_visual.js";
import type { ConstructionColliderSet } from "./construction_collider.js";
import type { ConstructionOverlapIndex } from "./overlap_index.js";
import type { ConstructionSnapIndex } from "./snap_index.js";
import type {
  ConstructionMaterial,
  ConstructionPieceDef,
  ConstructionStabilityConfig,
  PlacedConstructionPiece,
} from "./types.js";

const STABILITY_TINT_STRENGTH = 0.68;
const UNSUPPORTED_COLOR = new THREE.Color(1.0, 0.12, 0.08);

function colorMaterials(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

export class ConstructionPieceStore {
  readonly pieces: PlacedConstructionPiece[] = [];
  readonly meshes: THREE.Mesh[] = [];
  private readonly originalColors = new Map<string, THREE.Color[]>();
  private stabilityVisualizationEnabled = false;

  constructor(
    private readonly root: THREE.Group,
    private readonly piecesById: ReadonlyMap<string, ConstructionPieceDef>,
    private readonly snapIndex: ConstructionSnapIndex,
    private readonly overlapIndex: ConstructionOverlapIndex,
    private readonly colliderSet: ConstructionColliderSet | null = null,
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
    if (placed.unsupported === true) this.applyUnsupportedColor(placed.id, mesh);
    if (logPlacement) {
      console.info(`[construction] placed ${piece.label} (${constructionMaterialLabel(material)}) at ${placed.position.map((value) => value.toFixed(2)).join(", ")}`);
    }
    return true;
  }

  /** Legacy helper retained for save/hardening callers; Phase 2 controller no longer uses cascading deletion. */
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
      this.originalColors.delete(placed.id);
      this.pieces.splice(index, 1);
      this.meshes.splice(index, 1);
      removed += 1;
    }
    return removed;
  }

  /** Compatibility path for the legacy terrain-support tests and imported saves. */
  applySupportState(
    groundedLost: readonly string[],
    groundedRestored: readonly string[],
    unsupportedIds: ReadonlySet<string>,
  ): void {
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
      if (!mesh) continue;
      if (unsupported) this.applyUnsupportedColor(placed.id, mesh);
      else this.restoreOriginalColors(placed.id, mesh);
    }
  }

  setStabilityVisualization(enabled: boolean, config: ConstructionStabilityConfig): void {
    this.stabilityVisualizationEnabled = enabled;
    this.refreshStabilityVisuals(config);
  }

  refreshStabilityVisuals(config: ConstructionStabilityConfig, changedIds?: ReadonlySet<string>): void {
    for (let index = 0; index < this.pieces.length; index += 1) {
      const placed = this.pieces[index]!;
      if (changedIds && !changedIds.has(placed.id)) continue;
      const mesh = this.meshes[index];
      if (!mesh) continue;
      if (!this.stabilityVisualizationEnabled) {
        if (placed.unsupported === true) this.applyUnsupportedColor(placed.id, mesh);
        else this.restoreOriginalColors(placed.id, mesh);
        continue;
      }
      this.applyStabilityColor(placed, mesh, config);
    }
  }

  unsupportedCount(): number {
    return this.pieces.filter((piece) => piece.unsupported === true).length;
  }

  isMarkedUnsupported(id: string): boolean {
    return this.pieces.some((piece) => piece.id === id && piece.unsupported === true);
  }

  private captureOriginalColors(id: string, mesh: THREE.Mesh): THREE.Color[] {
    const cached = this.originalColors.get(id);
    if (cached) return cached;
    const originals = colorMaterials(mesh).map((material) => {
      const colored = material as THREE.Material & { color?: THREE.Color };
      return colored.color?.clone() ?? new THREE.Color(1, 1, 1);
    });
    this.originalColors.set(id, originals);
    return originals;
  }

  private applyUnsupportedColor(id: string, mesh: THREE.Mesh): void {
    const originals = this.captureOriginalColors(id, mesh);
    colorMaterials(mesh).forEach((material, materialIndex) => {
      const colored = material as THREE.Material & { color?: THREE.Color };
      if (!colored.color) return;
      colored.color.copy(originals[materialIndex] ?? new THREE.Color(1, 1, 1)).lerp(UNSUPPORTED_COLOR, STABILITY_TINT_STRENGTH);
    });
  }

  private applyStabilityColor(
    placed: PlacedConstructionPiece,
    mesh: THREE.Mesh,
    config: ConstructionStabilityConfig,
  ): void {
    const definition = this.piecesById.get(placed.typeId);
    if (!definition) return;
    const materialId = placed.material ?? definition.material;
    const profile = config.materialProfiles[materialId];
    const materials = colorMaterials(mesh);
    const originals = this.captureOriginalColors(placed.id, mesh);
    const stabilityColor = new THREE.Color(constructionStabilityColorHex({
      grounded: placed.grounded === true,
      value: placed.stability ?? 0,
      maxSupport: profile.maxSupport,
      config,
    }));
    materials.forEach((material, materialIndex) => {
      const colored = material as THREE.Material & { color?: THREE.Color };
      if (!colored.color) return;
      colored.color.copy(originals[materialIndex] ?? new THREE.Color(1, 1, 1)).lerp(stabilityColor, STABILITY_TINT_STRENGTH);
    });
  }

  private restoreOriginalColors(id: string, mesh: THREE.Mesh): void {
    const originals = this.originalColors.get(id);
    if (!originals) return;
    colorMaterials(mesh).forEach((material, materialIndex) => {
      const colored = material as THREE.Material & { color?: THREE.Color };
      if (colored.color && originals[materialIndex]) colored.color.copy(originals[materialIndex]!);
    });
    this.originalColors.delete(id);
  }

  dispose(): void {
    for (const mesh of this.meshes) disposeMesh(mesh);
    this.meshes.length = 0;
    this.pieces.length = 0;
    this.originalColors.clear();
    this.colliderSet?.dispose();
  }
}
