import * as THREE from "three";
import { DEFAULT_CONSTRUCTION_SUPPORT_PROFILES } from "./config.js";
import { constructionMaterialLabel, createConstructionMaterial } from "./materials.js";
import { createPieceGeometry, disposeMesh } from "./construction_controller_support.js";
import { constructionStabilityColorHex, constructionSupportProfile } from "./construction_stability.js";
import { ConstructionSupportGraph } from "./construction_support_graph.js";
import type { ConstructionColliderSet } from "./construction_collider.js";
import type { ConstructionOverlapIndex } from "./overlap_index.js";
import type { ConstructionSnapIndex } from "./snap_index.js";
import type {
  ConstructionMaterial,
  ConstructionPieceDef,
  ConstructionSupportProfiles,
  PlacedConstructionPiece,
} from "./types.js";

export interface ConstructionPieceRemovalResult {
  removedCount: number;
  removedIds: readonly string[];
  disconnectedNeighborIds: readonly string[];
}

export interface ConstructionPieceStoreOptions {
  graph?: ConstructionSupportGraph;
  supportProfiles?: ConstructionSupportProfiles;
}

export class ConstructionPieceStore {
  readonly pieces: PlacedConstructionPiece[] = [];
  readonly meshes: THREE.Mesh[] = [];
  readonly graph: ConstructionSupportGraph;
  private readonly supportProfiles: ConstructionSupportProfiles;
  private readonly baseColors = new Map<string, THREE.Color>();
  private stabilityVisualizationActive = false;
  private collapseThreshold = 0.20;

  constructor(
    private readonly root: THREE.Group,
    private readonly piecesById: ReadonlyMap<string, ConstructionPieceDef>,
    private readonly snapIndex: ConstructionSnapIndex,
    private readonly overlapIndex: ConstructionOverlapIndex,
    private readonly colliderSet: ConstructionColliderSet | null = null,
    private readonly materialFactory: (material: ConstructionMaterial) => THREE.Material = createConstructionMaterial,
    options: ConstructionPieceStoreOptions = {},
  ) {
    this.graph = options.graph ?? new ConstructionSupportGraph();
    this.supportProfiles = options.supportProfiles ?? DEFAULT_CONSTRUCTION_SUPPORT_PROFILES;
  }

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
    this.graph.addNode(placed.id);
    for (const connectionId of placed.connectionIds ?? placed.parentIds ?? []) this.graph.connect(placed.id, connectionId);
    const meshMaterial = mesh.material as THREE.MeshStandardMaterial;
    if (meshMaterial?.color) this.baseColors.set(placed.id, meshMaterial.color.clone());
    this.applyPieceVisual(placed.id);
    if (logPlacement) {
      console.info(`[construction] placed ${piece.label} (${constructionMaterialLabel(material)}) at ${placed.position.map((value) => value.toFixed(2)).join(", ")}`);
    }
    return true;
  }

  /** Legacy helper retained for migration tests. Runtime deletion no longer uses recursive descendants. */
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

  removeOne(id: string): ConstructionPieceRemovalResult {
    return this.removeByIds(new Set([id]));
  }

  removeByIds(ids: ReadonlySet<string>): ConstructionPieceRemovalResult {
    const removedIds: string[] = [];
    const disconnectedNeighborIds = new Set<string>();
    for (let index = this.pieces.length - 1; index >= 0; index -= 1) {
      const placed = this.pieces[index]!;
      if (!ids.has(placed.id)) continue;
      for (const neighbor of this.graph.removeNode(placed.id)) {
        if (!ids.has(neighbor)) disconnectedNeighborIds.add(neighbor);
      }
      const mesh = this.meshes[index];
      if (mesh) {
        this.root.remove(mesh);
        disposeMesh(mesh);
      }
      this.snapIndex.removeEntity(placed.id);
      this.overlapIndex.removeEntity(placed.id);
      this.colliderSet?.remove(placed.id);
      this.baseColors.delete(placed.id);
      this.pieces.splice(index, 1);
      this.meshes.splice(index, 1);
      removedIds.push(placed.id);
    }
    return {
      removedCount: removedIds.length,
      removedIds: removedIds.sort(),
      disconnectedNeighborIds: [...disconnectedNeighborIds].sort(),
    };
  }

  setStabilityVisualization(active: boolean, collapseThreshold: number): void {
    this.stabilityVisualizationActive = active;
    this.collapseThreshold = collapseThreshold;
    this.refreshStabilityVisuals();
  }

  refreshStabilityVisuals(ids?: Iterable<string>): void {
    const filter = ids ? new Set(ids) : null;
    for (const placed of this.pieces) {
      if (!filter || filter.has(placed.id)) this.applyPieceVisual(placed.id);
    }
  }

  applySupportState(groundedLost: readonly string[], groundedRestored: readonly string[], unsupportedIds: ReadonlySet<string>): void {
    const lost = new Set(groundedLost);
    const restored = new Set(groundedRestored);
    for (const placed of this.pieces) {
      if (lost.has(placed.id)) placed.grounded = false;
      else if (restored.has(placed.id)) placed.grounded = true;
      if (unsupportedIds.has(placed.id)) placed.unsupported = true;
      else delete placed.unsupported;
    }
    this.refreshStabilityVisuals();
  }

  unsupportedCount(): number {
    return this.pieces.reduce((count, piece) => count + (piece.unsupported === true ? 1 : 0), 0);
  }

  isMarkedUnsupported(id: string): boolean {
    return this.pieces.find((piece) => piece.id === id)?.unsupported === true;
  }

  dispose(): void {
    for (const mesh of this.meshes) disposeMesh(mesh);
    this.meshes.length = 0;
    this.pieces.length = 0;
    this.baseColors.clear();
    this.graph.clear();
    this.colliderSet?.dispose();
  }

  private applyPieceVisual(id: string): void {
    const index = this.pieces.findIndex((piece) => piece.id === id);
    if (index < 0) return;
    const placed = this.pieces[index]!;
    const mesh = this.meshes[index];
    const definition = this.piecesById.get(placed.typeId);
    const material = mesh?.material as THREE.MeshStandardMaterial | undefined;
    const baseColor = this.baseColors.get(id);
    if (!mesh || !definition || !material?.color || !baseColor) return;
    if (!this.stabilityVisualizationActive) {
      material.color.copy(baseColor);
      return;
    }
    const pieceMaterial = placed.material ?? definition.material;
    const profile = constructionSupportProfile(definition, pieceMaterial, this.supportProfiles);
    material.color.setHex(constructionStabilityColorHex(
      placed.stability ?? 0,
      profile.maxSupport,
      placed.grounded === true,
      this.collapseThreshold,
    ));
  }
}
