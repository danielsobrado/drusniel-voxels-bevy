import * as THREE from "three";

export interface MaterialChurnConfig {
  enabled: boolean;
  collectMaterialVersions: boolean;
  collectRendererPrograms: boolean;
  logSpikeWarnings: boolean;
  spikeWarnThresholdPerFrame: number;
  maxTrackedMaterials: number;
}

export interface MaterialChurnFrameStats {
  enabled: boolean;
  frame: number;
  newMaterials: number;
  materialReplacements: number;
  materialNeedsUpdate: number;
  materialVersionChanges: number;
  pipelineSensitiveChanges: number;
  rendererProgramCount: number | null;
  rendererProgramDelta: number | null;
  suspectedPipelineKeyChanges: number;
}

export interface MaterialChurnTotals {
  newMaterials: number;
  materialReplacements: number;
  materialNeedsUpdate: number;
  materialVersionChanges: number;
  pipelineSensitiveChanges: number;
  suspectedPipelineKeyChanges: number;
}

export const DEFAULT_MATERIAL_CHURN_CONFIG: MaterialChurnConfig = {
  enabled: true,
  collectMaterialVersions: true,
  collectRendererPrograms: true,
  logSpikeWarnings: false,
  spikeWarnThresholdPerFrame: 32,
  maxTrackedMaterials: 4096,
};

type TrackedMaterial = {
  material: THREE.Material;
  version: number;
};

const ZERO_TOTALS: MaterialChurnTotals = {
  newMaterials: 0,
  materialReplacements: 0,
  materialNeedsUpdate: 0,
  materialVersionChanges: 0,
  pipelineSensitiveChanges: 0,
  suspectedPipelineKeyChanges: 0,
};

export class MaterialChurnDiagnostics {
  private config: MaterialChurnConfig;
  private currentFrame = 0;
  private lastRendererProgramCount: number | null = null;
  private frame: MaterialChurnFrameStats;
  private total: MaterialChurnTotals = { ...ZERO_TOTALS };
  private trackedMaterials = new Map<string, TrackedMaterial>();
  private frameReasons = new Map<string, number>();

  constructor(config: Partial<MaterialChurnConfig> = {}) {
    this.config = { ...DEFAULT_MATERIAL_CHURN_CONFIG, ...config };
    this.frame = this.emptyFrame(0);
  }

  configure(config: Partial<MaterialChurnConfig>): void {
    this.config = { ...this.config, ...config };
    this.frame.enabled = this.config.enabled;
  }

  beginFrame(frame: number): void {
    if (this.config.enabled && this.config.logSpikeWarnings) {
      this.warnIfNeeded();
    }
    this.currentFrame = frame;
    this.frame = this.emptyFrame(frame);
    this.frameReasons.clear();
    if (this.config.enabled && this.config.collectMaterialVersions) {
      this.sampleTrackedMaterialVersions();
    }
  }

  trackNewMaterial(material: THREE.Material, reason: string): void {
    if (!this.config.enabled) return;
    const firstSeen = this.trackMaterial(material);
    if (!firstSeen) return;
    this.frame.newMaterials += 1;
    this.total.newMaterials += 1;
    this.addReason(reason);
  }

  trackMaterialAssigned(
    ownerId: string,
    previous: THREE.Material | null | undefined,
    next: THREE.Material,
    reason: string,
  ): void {
    if (!this.config.enabled || previous === next) return;
    this.trackMaterial(next);
    this.frame.materialReplacements += 1;
    this.total.materialReplacements += 1;
    this.addReason(`${reason}:${ownerId}`);
  }

  trackNeedsUpdate(material: THREE.Material, reason: string): void {
    if (!this.config.enabled) return;
    this.trackMaterial(material);
    this.frame.materialNeedsUpdate += 1;
    this.frame.suspectedPipelineKeyChanges += 1;
    this.total.materialNeedsUpdate += 1;
    this.total.suspectedPipelineKeyChanges += 1;
    this.addReason(reason);
  }

  trackPipelineSensitiveMutation(
    material: THREE.Material,
    property: string,
    previous: unknown,
    next: unknown,
    reason: string,
  ): boolean {
    if (Object.is(previous, next)) return false;
    if (!this.config.enabled) return true;
    this.trackMaterial(material);
    this.frame.pipelineSensitiveChanges += 1;
    this.frame.suspectedPipelineKeyChanges += 1;
    this.total.pipelineSensitiveChanges += 1;
    this.total.suspectedPipelineKeyChanges += 1;
    this.addReason(`${reason}:${property}`);
    return true;
  }

  sampleRendererInfo(renderer: unknown): void {
    if (!this.config.enabled || !this.config.collectRendererPrograms) return;
    const info = (renderer as { info?: { programs?: unknown[] } } | null)?.info;
    const programCount = Array.isArray(info?.programs) ? info.programs.length : null;
    this.frame.rendererProgramCount = programCount;
    this.frame.rendererProgramDelta = programCount === null || this.lastRendererProgramCount === null
      ? null
      : programCount - this.lastRendererProgramCount;
    if (programCount !== null) this.lastRendererProgramCount = programCount;
  }

  frameStats(): MaterialChurnFrameStats {
    return { ...this.frame };
  }

  totals(): MaterialChurnTotals {
    return { ...this.total };
  }

  dispose(): void {
    this.trackedMaterials.clear();
    this.frameReasons.clear();
    this.lastRendererProgramCount = null;
    this.frame = this.emptyFrame(this.currentFrame);
    this.total = { ...ZERO_TOTALS };
  }

  private emptyFrame(frame: number): MaterialChurnFrameStats {
    return {
      enabled: this.config.enabled,
      frame,
      newMaterials: 0,
      materialReplacements: 0,
      materialNeedsUpdate: 0,
      materialVersionChanges: 0,
      pipelineSensitiveChanges: 0,
      rendererProgramCount: this.lastRendererProgramCount,
      rendererProgramDelta: null,
      suspectedPipelineKeyChanges: 0,
    };
  }

  private trackMaterial(material: THREE.Material): boolean {
    const key = material.uuid || String(material.id);
    if (this.trackedMaterials.has(key)) return false;
    if (this.trackedMaterials.size >= this.config.maxTrackedMaterials) return false;
    this.trackedMaterials.set(key, { material, version: material.version });
    return true;
  }

  private sampleTrackedMaterialVersions(): void {
    for (const tracked of this.trackedMaterials.values()) {
      const nextVersion = tracked.material.version;
      if (nextVersion === tracked.version) continue;
      const delta = Math.max(1, nextVersion - tracked.version);
      tracked.version = nextVersion;
      this.frame.materialVersionChanges += delta;
      this.frame.suspectedPipelineKeyChanges += delta;
      this.total.materialVersionChanges += delta;
      this.total.suspectedPipelineKeyChanges += delta;
    }
  }

  private addReason(reason: string): void {
    this.frameReasons.set(reason, (this.frameReasons.get(reason) ?? 0) + 1);
  }

  private warnIfNeeded(): void {
    const churn = this.frame.newMaterials + this.frame.materialNeedsUpdate + this.frame.pipelineSensitiveChanges;
    if (churn < this.config.spikeWarnThresholdPerFrame) return;
    const reasons = [...this.frameReasons.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([reason, count]) => `${reason}=${count}`)
      .join(" ");
    console.warn(
      `[clod material churn] frame=${this.frame.frame}` +
        ` new=${this.frame.newMaterials}` +
        ` assign=${this.frame.materialReplacements}` +
        ` needsUpdate=${this.frame.materialNeedsUpdate}` +
        ` pipelineSensitive=${this.frame.pipelineSensitiveChanges}` +
        (reasons ? ` reasons=${reasons}` : ""),
    );
  }
}

export const materialChurnDiagnostics = new MaterialChurnDiagnostics();

export function setPipelineSensitiveMaterialProperty(
  diagnostics: MaterialChurnDiagnostics | null,
  material: THREE.Material,
  key: string,
  value: unknown,
  reason: string,
): boolean {
  const writable = material as unknown as Record<string, unknown>;
  const previous = writable[key];
  if (Object.is(previous, value)) return false;
  diagnostics?.trackPipelineSensitiveMutation(material, key, previous, value, reason);
  writable[key] = value;
  return true;
}

export function setMaterialNeedsUpdate(
  diagnostics: MaterialChurnDiagnostics | null,
  material: THREE.Material,
  reason: string,
): void {
  material.needsUpdate = true;
  diagnostics?.trackNeedsUpdate(material, reason);
}

export function applyMaterialIfChanged(
  diagnostics: MaterialChurnDiagnostics | null,
  ownerId: string,
  mesh: THREE.Mesh,
  nextMaterial: THREE.Material,
  reason: string,
): boolean {
  if (!Array.isArray(mesh.material) && mesh.material === nextMaterial) return false;
  const previous = Array.isArray(mesh.material) ? null : mesh.material;
  mesh.material = nextMaterial;
  diagnostics?.trackMaterialAssigned(ownerId, previous, nextMaterial, reason);
  return true;
}
