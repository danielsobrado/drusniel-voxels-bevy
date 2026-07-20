import type { TreeCanopyCompetitionBinding } from "./tree_canopy_competition_binding.js";

export interface TreeRingBindGroupResources {
  readonly paramBuffer: GPUBuffer;
  readonly counterBuffer: GPUBuffer;
  readonly indirectArgs: GPUBuffer;
  readonly shadowCounterBuffer: GPUBuffer;
  readonly shadowIndirectArgs: GPUBuffer;
  readonly shadowCell: GPUBuffer;
  readonly cell: GPUBuffer;
  readonly digEdits: GPUBuffer;
  readonly fieldParams: GPUBuffer;
  readonly hydroTexture: GPUTexture;
  readonly hydroSampler: GPUSampler;
  readonly visibleClusterMaskBuffer: GPUBuffer;
  readonly activeSlotBuffer: GPUBuffer;
  readonly hydroAtlasTexture: GPUTexture;
  readonly canonicalHeightView: GPUTextureView;
  readonly canonicalResidencyView: GPUTextureView;
  readonly canonicalHeightParams: GPUBuffer;
  readonly canopyCompetition: TreeCanopyCompetitionBinding;
}

export function createTreeRingBindGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  resources: TreeRingBindGroupResources,
): GPUBindGroup {
  return device.createBindGroup({
    label: "tree ring bind group",
    layout,
    entries: [
      { binding: 0, resource: { buffer: resources.paramBuffer } },
      { binding: 1, resource: { buffer: resources.counterBuffer } },
      { binding: 2, resource: { buffer: resources.indirectArgs } },
      { binding: 3, resource: { buffer: resources.cell } },
      { binding: 4, resource: { buffer: resources.shadowCounterBuffer } },
      { binding: 5, resource: { buffer: resources.shadowIndirectArgs } },
      { binding: 6, resource: { buffer: resources.shadowCell } },
      { binding: 7, resource: { buffer: resources.digEdits } },
      { binding: 8, resource: { buffer: resources.fieldParams } },
      { binding: 9, resource: resources.hydroTexture.createView() },
      { binding: 10, resource: resources.hydroSampler },
      { binding: 11, resource: { buffer: resources.visibleClusterMaskBuffer } },
      { binding: 12, resource: { buffer: resources.activeSlotBuffer } },
      { binding: 13, resource: resources.hydroAtlasTexture.createView() },
      { binding: 14, resource: resources.canonicalHeightView },
      { binding: 15, resource: resources.canonicalResidencyView },
      { binding: 16, resource: { buffer: resources.canonicalHeightParams } },
      { binding: 17, resource: resources.canopyCompetition.view() },
    ],
  });
}
