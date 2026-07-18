import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { isRenderableIndirectDrawGeometry } from "../gpu/indirect_draw_geometry.js";
import type { CustomPropsSettings, PropAssetDef, PropAssetMetadata } from "./prop_types.js";
import { extractPropAssetMetadata } from "./prop_asset_metadata.js";
import { validateCustomPropsManifest, validatePropAssetMetadata } from "./prop_asset_validate.js";
import { buildPropLodChain, type PropLodChain } from "./prop_lod_build.js";
import { assignBillboardMaterial, createBillboardMaterial, disposeBillboardGeometryResources } from "./prop_billboard.js";

function firstRenderableMesh(root: THREE.Object3D): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  root.traverse((obj) => {
    if (!found && obj instanceof THREE.Mesh && isRenderableIndirectDrawGeometry(obj.geometry)) found = obj;
  });
  return found;
}

function firstInvalidLodIndex(chain: PropLodChain): number {
  return chain.levels.findIndex((level) => !isRenderableIndirectDrawGeometry(level.geometry));
}

function disposePropLodChain(chain: PropLodChain): void {
  for (const level of chain.levels) level.geometry.dispose();
  disposeBillboardGeometryResources(chain.billboardGeometry);
}

function disposeObjectGraph(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.geometry?.dispose();
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const material of materials) material?.dispose();
  });
}

export interface LoadedPropAsset {
  def: PropAssetDef;
  root: THREE.Group;
  metadata: PropAssetMetadata;
  lodChain: PropLodChain | null;
  lodErrorWorld: number[];
  sourceMaterial: THREE.Material;
}

export class PropAssetRegistry {
  private readonly loader = new GLTFLoader();
  private readonly assets = new Map<string, LoadedPropAsset>();
  private readonly loading = new Map<string, Promise<LoadedPropAsset>>();
  private disposed = false;

  constructor(private readonly settings: CustomPropsSettings) {}

  get settingsRef(): CustomPropsSettings {
    return this.settings;
  }

  getAsset(id: string): LoadedPropAsset | undefined {
    return this.assets.get(id);
  }

  getMetadata(id: string): PropAssetMetadata | undefined {
    return this.assets.get(id)?.metadata;
  }

  instantiate(id: string): THREE.Group | null {
    const asset = this.assets.get(id);
    if (!asset) return null;
    return asset.root.clone(true);
  }

  async loadManifest(): Promise<{ loaded: LoadedPropAsset[]; manifestReport: ReturnType<typeof validateCustomPropsManifest> }> {
    this.assertActive();
    const manifestReport = validateCustomPropsManifest(this.settings);
    const loaded: LoadedPropAsset[] = [];
    for (const def of this.settings.props) {
      try {
        const asset = await this.loadAsset(def);
        loaded.push(asset);
      } catch (error) {
        console.warn(`[props] skipped prop asset "${def.id}"`, error);
      }
    }
    return { loaded, manifestReport };
  }

  async loadAsset(def: PropAssetDef): Promise<LoadedPropAsset> {
    this.assertActive();
    const cached = this.assets.get(def.id);
    if (cached) return cached;
    const inflight = this.loading.get(def.id);
    if (inflight) return inflight;

    const promise = this.loadAssetUncached(def).finally(() => {
      this.loading.delete(def.id);
    });
    this.loading.set(def.id, promise);
    return promise;
  }

  private async loadAssetUncached(def: PropAssetDef): Promise<LoadedPropAsset> {
    const gltf = await this.loader.loadAsync(def.source);
    const root = new THREE.Group();
    root.name = `prop:${def.id}`;
    root.add(gltf.scene);

    let lodChain: PropLodChain | null = null;
    try {
      this.assertActive();
      const sourceMesh = firstRenderableMesh(root);
      if (!sourceMesh) throw new Error(`Prop asset "${def.id}" has no renderable mesh`);

      const sourceMaterial = Array.isArray(sourceMesh.material) ? sourceMesh.material[0]! : sourceMesh.material;
      let lodErrorWorld: number[] = [];

      if (def.lod.mode === "generated") {
        lodChain = await buildPropLodChain(sourceMesh.geometry, def, extractPropAssetMetadata(root, def).boundingSphereRadius);
        this.assertActive();
        const invalidLod = firstInvalidLodIndex(lodChain);
        if (invalidLod >= 0) throw new Error(`Prop asset "${def.id}" generated empty LOD ${invalidLod}`);
        lodErrorWorld = lodChain.levels.map((level) => level.errorWorld);
        if (lodChain.billboardGeometry && isRenderableIndirectDrawGeometry(lodChain.billboardGeometry)) {
          assignBillboardMaterial(lodChain.billboardGeometry, createBillboardMaterial(sourceMaterial));
        } else if (lodChain.billboardGeometry) {
          disposeBillboardGeometryResources(lodChain.billboardGeometry);
          lodChain.billboardGeometry = null;
        }
      }

      const metadata = extractPropAssetMetadata(root, def, {
        lodAvailability: def.lod.mode === "generated" ? "generated" : "provided",
      });
      if (lodChain) {
        metadata.triangleCount = lodChain.levels[0]?.triangleCount ?? metadata.triangleCount;
      }

      const report = validatePropAssetMetadata(def, metadata, this.settings);
      if (!report.ok) {
        const detail = report.errors.map((e) => e.message).join("; ");
        throw new Error(`Rejected prop asset "${def.id}": ${detail}`);
      }
      for (const warning of report.warnings) {
        console.warn(`[props] ${warning.message}`);
      }

      this.assertActive();
      const loaded: LoadedPropAsset = {
        def,
        root,
        metadata,
        lodChain,
        lodErrorWorld,
        sourceMaterial,
      };
      this.assets.set(def.id, loaded);
      return loaded;
    } catch (error) {
      if (lodChain) disposePropLodChain(lodChain);
      disposeObjectGraph(root);
      throw error;
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const asset of this.assets.values()) {
      if (asset.lodChain) disposePropLodChain(asset.lodChain);
      disposeObjectGraph(asset.root);
    }
    this.assets.clear();
    this.loading.clear();
  }

  private assertActive(): void {
    if (this.disposed) throw new Error("Prop asset registry is disposed");
  }
}
