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

function clonePlacedPiece(placed: PlacedConstructionPiece): PlacedConstructionPiece {
  return {
    ...placed,
    position: [placed.position[0], placed.position[1], placed.position[2]],
    connectionIds: placed.connectionIds ? [...placed.connectionIds] : undefined,
    parentIds: placed.parentIds ? [...placed.parentIds] : undefined,
  };
}

export class ConstructionPieceStore {
  readonly pieces: PlacedConstructionPiece[] = [];
  readonly meshes: THREE.Mesh[] = [];
  readonly graph: ConstructionSupportGraph;
  private readonly supportProfiles: ConstructionSupportProfiles;
  private readonly pieceIds = new Set<string>();
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
      this.graph.addNode(stored.id);
      for (const connectionId of stored.connectionIds ?? stored.parentIds ?? []) this.graph.connect(stored.id, connectionId);
      this.root.add(mesh);
      this.meshes.push(mesh);
      this.pieces.push(stored);
      this.pieceIds.add(stored.id);
      const meshMaterial = mesh.material as THREE.MeshStandardMaterial;
      if (meshMaterial?.color) this.baseColors.set(stored.id, meshMaterial.color.clone());
      this.applyPieceVisual(stored.id);
    } catch (error) {
      this.graph.removeNode(stored.id);
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
      this.pieceIds.delete(placed.id);
      this.baseColors.delete(placed.id);
      this.pieces.splice(index, 1);
      this.meshes.splice(index, 1);
      removedIds.push(placed.id);
    }

    if (removedIds.length > 0) {
      const removed = new Set(removedIds);
      for (const placed of this.pieces) {
        if (placed.connectionIds) {
          placed.connectionIds = placed.connectionIds.filter((connectionId) => !removed.has(connectionId));
        }
        if (placed.parentIds) {
          placed.parentIds = placed.parentIds.filter((parentId) => !removed.has(parentId));
        }
      }
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
    for (let index = 0; index < this.meshes.length; index += 1) {
      const placed = this.pieces[index];
      if (placed) {
        this.snapIndex.removeEntity(placed.id);
        this.overlapIndex.removeEntity(placed.id);
        this.graph.removeNode(placed.id);
      }
      const mesh = this.meshes[index]!;
      this.root.remove(mesh);
      disposeMesh(mesh);
    }
    this.meshes.length = 0;
    this.pieces.length = 0;
    this.pieceIds.clear();
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
