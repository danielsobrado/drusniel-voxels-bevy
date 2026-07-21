import type { VegetationGpuBackend } from "../../../runtime/vegetation/vegetation_gpu_backend.js";
import { DRESSING_CLASSES } from "../class_registry.js";
import {
  DRESSING_GPU_GROUP_COUNT,
  DRESSING_GPU_INDIRECT_WORDS,
  DRESSING_GPU_LOD_COUNT,
  DRESSING_GPU_RECORD_VEC4S,
  DRESSING_GPU_WORKGROUP_SIZE,
} from "./layouts.js";
import type { DressingGpuOutputBuffers } from "./render_resources.js";
import {
  DRESSING_GRASS_CONTACT_STRENGTH_SCALE,
  readDressingGrassContactConfig,
} from "./dressing_grass_contact_config.js";
import {
  DRESSING_GRASS_CONTACT_FIELD_CAPACITY,
  ensureDressingGrassContactGpuResources,
  registerDressingGrassContactField,
  type DressingGrassContactRegistration,
} from "./dressing_grass_contact_field.js";

const PARAM_BYTES = 8 * Uint32Array.BYTES_PER_ELEMENT;
const POLICY_FLOATS_PER_CLASS = 2;

type PipelineName = "clear_field" | "rasterize_records";

export interface DressingGrassContactComputeStats {
  readonly active: boolean;
  readonly contentRevision: number;
  readonly dispatches: number;
  readonly fieldCells: number;
  readonly submitCpuMs: number;
  readonly readbacks: 0;
}

export class DressingGrassContactCompute {
  private readonly paramBuffer: GPUBuffer;
  private readonly policyBuffer: GPUBuffer;
  private readonly bindGroup: GPUBindGroup;
  private readonly paramsScratch = new ArrayBuffer(PARAM_BYTES);
  private readonly registration: DressingGrassContactRegistration;
  private disposed = false;
  private dispatches = 0;
  private contentRevision = 0;
  private submitCpuMs = 0;

  private constructor(
    private readonly device: GPUDevice,
    private readonly pipelines: Record<PipelineName, GPUComputePipeline>,
    layout: GPUBindGroupLayout,
    outputBuffers: DressingGpuOutputBuffers,
    fieldBuffer: GPUBuffer,
    private readonly capacityPerGroup: number,
  ) {
    this.paramBuffer = device.createBuffer({
      label: "dressing grass-contact params",
      size: PARAM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.policyBuffer = device.createBuffer({
      label: "dressing grass-contact class policies",
      size: DRESSING_CLASSES.length * POLICY_FLOATS_PER_CLASS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(
      this.policyBuffer,
      0,
      packClassPolicies().buffer as ArrayBuffer,
    );
    this.bindGroup = device.createBindGroup({
      label: "dressing grass-contact bind group",
      layout,
      entries: [
        { binding: 0, resource: { buffer: this.paramBuffer } },
        { binding: 1, resource: { buffer: outputBuffers.records } },
        { binding: 2, resource: { buffer: outputBuffers.indirectArgs } },
        { binding: 3, resource: { buffer: fieldBuffer } },
        { binding: 4, resource: { buffer: this.policyBuffer } },
      ],
    });
    this.registration = registerDressingGrassContactField();
  }

  static async create(
    device: GPUDevice,
    backend: VegetationGpuBackend,
    outputBuffers: DressingGpuOutputBuffers,
    capacityPerGroup: number,
  ): Promise<DressingGrassContactCompute> {
    const field = ensureDressingGrassContactGpuResources(backend);
    const module = device.createShaderModule({
      label: "dressing grass-contact shader",
      code: dressingGrassContactShader(),
    });
    const layout = device.createBindGroupLayout({
      label: "dressing grass-contact layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      ],
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const createPipeline = (entryPoint: PipelineName) => device.createComputePipelineAsync({
      label: `dressing grass-contact ${entryPoint}`,
      layout: pipelineLayout,
      compute: { module, entryPoint },
    });
    const [clearField, rasterizeRecords] = await Promise.all([
      createPipeline("clear_field"),
      createPipeline("rasterize_records"),
    ]);
    return new DressingGrassContactCompute(
      device,
      { clear_field: clearField, rasterize_records: rasterizeRecords },
      layout,
      outputBuffers,
      field.buffer,
      Math.max(1, Math.floor(capacityPerGroup)),
    );
  }

  dispatch(centerX: number, centerZ: number): void {
    if (this.disposed) return;
    const config = readDressingGrassContactConfig();
    const f32 = new Float32Array(this.paramsScratch);
    const u32 = new Uint32Array(this.paramsScratch);
    f32.fill(0);
    u32.fill(0);
    f32[0] = finiteOrZero(centerX);
    f32[1] = finiteOrZero(centerZ);
    f32[2] = config.fieldCellM;
    f32[3] = config.coreFraction;
    u32[4] = config.fieldGrid;
    u32[5] = this.capacityPerGroup;
    u32[6] = DRESSING_GPU_GROUP_COUNT;
    u32[7] = config.enabled ? 1 : 0;
    this.device.queue.writeBuffer(this.paramBuffer, 0, this.paramsScratch);

    const encoder = this.device.createCommandEncoder({ label: "dressing grass-contact encoder" });
    dispatchPipeline(
      encoder,
      this.pipelines.clear_field,
      this.bindGroup,
      Math.ceil(DRESSING_GRASS_CONTACT_FIELD_CAPACITY / DRESSING_GPU_WORKGROUP_SIZE),
    );
    if (config.enabled) {
      dispatchPipeline(
        encoder,
        this.pipelines.rasterize_records,
        this.bindGroup,
        Math.ceil((DRESSING_GPU_GROUP_COUNT * this.capacityPerGroup) / DRESSING_GPU_WORKGROUP_SIZE),
      );
    }
    const started = performance.now();
    this.device.queue.submit([encoder.finish()]);
    this.submitCpuMs = performance.now() - started;
    this.dispatches += 1;
    this.contentRevision += 1;
    this.registration.commit(centerX, centerZ, this.contentRevision);
  }

  stats(): DressingGrassContactComputeStats {
    const config = readDressingGrassContactConfig();
    return {
      active: config.enabled && !this.disposed,
      contentRevision: this.contentRevision,
      dispatches: this.dispatches,
      fieldCells: DRESSING_GRASS_CONTACT_FIELD_CAPACITY,
      submitCpuMs: this.submitCpuMs,
      readbacks: 0,
    };
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.registration.dispose();
    const resources = [this.paramBuffer, this.policyBuffer];
    void this.device.queue.onSubmittedWorkDone().then(() => {
      for (const resource of resources) resource.destroy();
    });
  }
}

export function dressingGrassContactShader(): string {
  return `
const WORKGROUP_SIZE: u32 = ${DRESSING_GPU_WORKGROUP_SIZE}u;
const LOD_COUNT: u32 = ${DRESSING_GPU_LOD_COUNT}u;
const RECORD_VEC4S: u32 = ${DRESSING_GPU_RECORD_VEC4S}u;
const INDIRECT_WORDS: u32 = ${DRESSING_GPU_INDIRECT_WORDS}u;
const STRENGTH_SCALE: f32 = ${DRESSING_GRASS_CONTACT_STRENGTH_SCALE}.0;

struct Params {
  center_cell: vec4<f32>,
  // Named "dims", not "layout": "layout" is a reserved keyword in WGSL and Dawn rejects
  // the whole module with "'layout' is a reserved keyword".
  dims: vec4<u32>,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> records: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> indirect_args: array<u32>;
@group(0) @binding(3) var<storage, read_write> field: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read> class_policies: array<vec2<f32>>;

@compute @workgroup_size(WORKGROUP_SIZE)
fn clear_field(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  let cells = params.dims.x * params.dims.x;
  if (index < cells) {
    atomicStore(&field[index], 0u);
  }
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn rasterize_records(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (params.dims.w == 0u) { return; }
  let capacity = params.dims.y;
  let group_count = params.dims.z;
  let flat = gid.x;
  if (flat >= group_count * capacity) { return; }
  let group = flat / capacity;
  let slot = flat % capacity;
  let accepted = min(indirect_args[group * INDIRECT_WORDS + 1u], capacity);
  if (slot >= accepted) { return; }

  let class_id = group / LOD_COUNT;
  let policy = class_policies[class_id];
  if (policy.x <= 0.0 || policy.y <= 0.0) { return; }
  let record_base = (group * capacity + slot) * RECORD_VEC4S;
  let position_scale = records[record_base];
  let radius = max(0.01, policy.x * max(position_scale.w, 0.01));
  let cell_m = max(params.center_cell.z, 0.01);
  let grid = params.dims.x;
  let half_extent = f32(grid) * cell_m * 0.5;
  let origin = params.center_cell.xy - vec2<f32>(half_extent);
  let min_cell = clamp(
    vec2<i32>(floor((position_scale.xz - vec2<f32>(radius) - origin) / cell_m)),
    vec2<i32>(0),
    vec2<i32>(i32(grid) - 1),
  );
  let max_cell = clamp(
    vec2<i32>(floor((position_scale.xz + vec2<f32>(radius) - origin) / cell_m)),
    vec2<i32>(0),
    vec2<i32>(i32(grid) - 1),
  );
  let inner = radius * clamp(params.center_cell.w, 0.0, 1.0);

  for (var z = min_cell.y; z <= max_cell.y; z = z + 1) {
    for (var x = min_cell.x; x <= max_cell.x; x = x + 1) {
      let world_xz = origin + (vec2<f32>(f32(x), f32(z)) + vec2<f32>(0.5)) * cell_m;
      let distance_m = distance(world_xz, position_scale.xz);
      let influence = (1.0 - smoothstep(inner, radius, distance_m)) * policy.y;
      let packed = u32(round(clamp(influence, 0.0, 1.0) * STRENGTH_SCALE));
      if (packed > 0u) {
        let field_index = u32(z) * grid + u32(x);
        atomicMax(&field[field_index], packed);
      }
    }
  }
}
`;
}

function packClassPolicies(): Float32Array {
  const config = readDressingGrassContactConfig();
  const packed = new Float32Array(DRESSING_CLASSES.length * POLICY_FLOATS_PER_CLASS);
  for (let index = 0; index < DRESSING_CLASSES.length; index++) {
    const policy = config.classes[DRESSING_CLASSES[index]!];
    packed[index * POLICY_FLOATS_PER_CLASS] = policy?.radiusM ?? 0;
    packed[index * POLICY_FLOATS_PER_CLASS + 1] = policy?.strength ?? 0;
  }
  return packed;
}

function dispatchPipeline(
  encoder: GPUCommandEncoder,
  pipeline: GPUComputePipeline,
  bindGroup: GPUBindGroup,
  workgroups: number,
): void {
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.max(1, Math.floor(workgroups)));
  pass.end();
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
