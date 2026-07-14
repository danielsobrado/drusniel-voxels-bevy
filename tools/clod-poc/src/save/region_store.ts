import { parseRegionKey } from "./region_key.js";
import type { RegionManifest, RegionVoxelDeltas, SavedPropInstance, SaveWorldManifest, WorldMetadataRecord } from "./save_schema.js";
import { assertRegionManifest, assertRegionRecordSet, assertRegionVoxelDeltas, assertWorldMetadataRecord } from "./save_schema.js";

export interface SaveRegionRecords {
  manifest: RegionManifest;
  voxelDeltas: RegionVoxelDeltas;
  props: SavedPropInstance[];
}

export interface SaveWorldStoreSnapshot {
  manifest: SaveWorldManifest | null;
  metadata: WorldMetadataRecord | null;
  regions: SaveRegionRecords[];
  dirtyRegionKeys: string[];
  metadataDirty: boolean;
}

function cloneRegionRecords(records: SaveRegionRecords): SaveRegionRecords {
  return {
    manifest: { ...records.manifest },
    voxelDeltas: cloneVoxelDeltasRecord(records.voxelDeltas),
    props: records.props.map((prop) => ({ ...prop, position: [...prop.position], rotation: [...prop.rotation], scale: [...prop.scale], tags: [...prop.tags], environmental: prop.environmental ? { ...prop.environmental, tileKey: { ...prop.environmental.tileKey } } : undefined })),
  };
}

function cloneVoxelDeltasRecord(voxelDeltas: RegionVoxelDeltas): RegionVoxelDeltas {
  if (voxelDeltas.format === "json") {
    return { ...voxelDeltas, deltas: voxelDeltas.deltas.map((delta) => ({ ...delta })) };
  }
  const payload = voxelDeltas.payload instanceof ArrayBuffer
    ? voxelDeltas.payload.slice(0)
    : voxelDeltas.payload.slice();
  return { ...voxelDeltas, payload };
}

export class SaveWorldStore {
  private manifestValue: SaveWorldManifest | null = null;
  private metadataValue: WorldMetadataRecord | null = null;
  private readonly regions = new Map<string, SaveRegionRecords>();
  private readonly dirtyRegions = new Set<string>();
  private metadataDirtyValue = false;

  setManifest(manifest: SaveWorldManifest): void {
    this.manifestValue = { ...manifest, regionKeys: [...manifest.regionKeys] };
  }

  getManifest(): SaveWorldManifest | null {
    return this.manifestValue ? { ...this.manifestValue, regionKeys: [...this.manifestValue.regionKeys] } : null;
  }

  setMetadata(metadata: WorldMetadataRecord, dirty = true): void {
    assertWorldMetadataRecord(metadata);
    this.metadataValue = structuredClone(metadata) as WorldMetadataRecord;
    this.metadataDirtyValue = dirty;
  }

  getMetadata(): WorldMetadataRecord | null {
    return this.metadataValue ? structuredClone(this.metadataValue) as WorldMetadataRecord : null;
  }

  upsertRegion(records: SaveRegionRecords, dirty = true): void {
    assertRegionManifest(records.manifest);
    assertRegionVoxelDeltas(records.voxelDeltas);
    assertRegionRecordSet(records.manifest, records.voxelDeltas, records.props);
    const { rx, rz } = parseRegionKey(records.manifest.regionKey);
    if (records.manifest.rx !== rx || records.manifest.rz !== rz) throw new Error("region manifest coordinate mismatch");
    this.regions.set(records.manifest.regionKey, cloneRegionRecords(records));
    if (dirty) this.markRegionDirty(records.manifest.regionKey);
  }

  getRegion(regionKey: string): SaveRegionRecords | null {
    const records = this.regions.get(regionKey);
    return records ? cloneRegionRecords(records) : null;
  }

  listRegionKeys(): string[] {
    return [...this.regions.keys()].sort();
  }

  listRegions(): SaveRegionRecords[] {
    return this.listRegionKeys().map((regionKey) => cloneRegionRecords(this.regions.get(regionKey)!));
  }

  markRegionDirty(regionKey: string): void {
    parseRegionKey(regionKey);
    this.dirtyRegions.add(regionKey);
  }

  clearRegionDirty(regionKey: string): void {
    this.dirtyRegions.delete(regionKey);
  }

  dirtyRegionKeys(): string[] {
    return [...this.dirtyRegions].sort();
  }

  markMetadataDirty(): void {
    this.metadataDirtyValue = true;
  }

  clearMetadataDirty(): void {
    this.metadataDirtyValue = false;
  }

  isMetadataDirty(): boolean {
    return this.metadataDirtyValue;
  }

  snapshot(): SaveWorldStoreSnapshot {
    return {
      manifest: this.getManifest(),
      metadata: this.getMetadata(),
      regions: this.listRegions(),
      dirtyRegionKeys: this.dirtyRegionKeys(),
      metadataDirty: this.metadataDirtyValue,
    };
  }
}
