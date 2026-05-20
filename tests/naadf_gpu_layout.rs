#[cfg(feature = "naadf")]
mod naadf_gpu_layout {
    use bevy::prelude::*;
    use serde::Deserialize;
    use std::sync::mpsc;
    use voxel_builder::constants::CHUNK_VOLUME;
    use voxel_builder::rendering::naadf::NaadfCpuRayBackend;
    use voxel_builder::rendering::naadf::cpu_builder::{
        NaadfBuildOptions, build_mip_pyramid_from_chunk, build_naadf_chunk,
    };
    use voxel_builder::rendering::naadf::gpu_buffers::{
        NAADF_PACKED_BLOCK_WORDS, NAADF_PACKED_CHUNK_WORDS, pack_naadf_chunk_upload,
        pack_raw_voxel_record,
    };
    use voxel_builder::rendering::naadf::gpu_tests::compare_mip_records_to_cpu;
    use voxel_builder::rendering::naadf::layout::{
        BLOCKS_PER_CHUNK, MIP_CELLS_PER_CHUNK, NAADF_BUILD_BLOCKS_LAYOUT,
        NAADF_BUILD_BOUNDS_LAYOUT, NAADF_BUILD_CHUNK_BOUNDS_LAYOUT, NAADF_BUILD_CHUNKS_LAYOUT,
        NAADF_BUILD_MIPS_LAYOUT, NaadfBindEntryKind, NaadfBindEntrySpec, NaadfNodeState,
        TRAVERSAL_RECORD_STATE_SHIFT, voxel_index_in_chunk,
    };
    use voxel_builder::rendering::voxel_ray_backend::VoxelRayPurpose;
    use voxel_builder::voxel::chunk::Chunk;
    use voxel_builder::voxel::types::{Voxel, VoxelType};
    use wgpu::util::DeviceExt;

    const VOXEL_BYTES: u64 = CHUNK_VOLUME as u64 * 4;
    const BLOCK_BYTES: u64 = BLOCKS_PER_CHUNK as u64 * NAADF_PACKED_BLOCK_WORDS as u64 * 4;
    const MIP_BYTES: u64 = MIP_CELLS_PER_CHUNK as u64 * 4;
    const CHUNK_BYTES: u64 = NAADF_PACKED_CHUNK_WORDS as u64 * 4;
    const LOOKUP_BYTES: u64 = 16;
    const PARAM_BYTES: u64 = 16;
    const SUN_VISIBILITY_MAX_STEPS: u32 = 64;

    #[derive(Debug, Deserialize)]
    struct NaadfFixture {
        name: String,
        #[serde(default)]
        fill: Option<String>,
        #[serde(default)]
        occupied: Vec<(Vec<u32>, String)>,
        #[serde(default)]
        occupied_rule: Option<String>,
        #[serde(default)]
        empty_rule: Option<String>,
        #[serde(default)]
        rays: Vec<NaadfFixtureRay>,
    }

    #[derive(Debug, Deserialize)]
    struct NaadfFixtureRay {
        origin: Vec<f32>,
        dir: Vec<f32>,
        max_distance: f32,
        hit: Option<Vec<u32>>,
    }

    #[repr(C)]
    #[derive(Clone, Copy, Debug, Default, bytemuck::Pod, bytemuck::Zeroable)]
    struct SunVisibilityRayInput {
        origin_max_distance: [f32; 4],
        direction_purpose: [f32; 4],
    }

    struct GpuContext {
        device: wgpu::Device,
        queue: wgpu::Queue,
    }

    #[test]
    fn gpu_build_dispatch_matches_cpu_upload_for_all_fixtures() {
        let gpu = pollster::block_on(GpuContext::new())
            .expect("NAADF GPU layout dispatch test requires a headless wgpu adapter");

        for (path, contents) in naadf_fixture_files() {
            let fixture: NaadfFixture = ron::de::from_str(contents)
                .unwrap_or_else(|err| panic!("failed to parse {path}: {err}"));
            let chunk = chunk_from_fixture(&fixture);
            let naadf = build_naadf_chunk(&chunk, NaadfBuildOptions::default());
            let expected = pack_naadf_chunk_upload(&naadf, 0);
            let actual = pollster::block_on(dispatch_gpu_build(&gpu, &chunk, &fixture.name));

            assert_records_eq(
                &fixture.name,
                chunk.position(),
                "chunk",
                &expected.chunk_record,
                &actual.chunk_record,
            );
            assert_records_eq(
                &fixture.name,
                chunk.position(),
                "block",
                &expected.block_records,
                &actual.block_records,
            );
            assert_records_eq(
                &fixture.name,
                chunk.position(),
                "voxel",
                &expected.voxel_records,
                &actual.voxel_records,
            );
            assert_records_eq(
                &fixture.name,
                chunk.position(),
                "material",
                &expected.material_records,
                &actual.material_records,
            );
            assert_base_mip_records_match_raw(
                &fixture.name,
                &expected.raw_voxel_records,
                &actual.mip_traversal_records,
                &actual.mip_payload_records,
            );
            let expected_mips = build_mip_pyramid_from_chunk(&naadf);
            let mip_failures = compare_mip_records_to_cpu(
                &expected_mips.traversal_records,
                &expected_mips.payload_records,
                &expected_mips.bounds_records,
                &actual.mip_traversal_records,
                &actual.mip_payload_records,
                &actual.mip_bounds_records,
            );
            assert!(
                mip_failures.is_empty(),
                "{}: GPU mip records differ from CPU reference: {:?}",
                fixture.name,
                mip_failures
            );
        }
    }

    #[test]
    fn gpu_sun_visibility_matches_cpu_for_all_fixtures() {
        let gpu = pollster::block_on(GpuContext::new())
            .expect("NAADF GPU sun visibility dispatch test requires a headless wgpu adapter");

        for (path, contents) in naadf_fixture_files() {
            let fixture: NaadfFixture = ron::de::from_str(contents)
                .unwrap_or_else(|err| panic!("failed to parse {path}: {err}"));
            let chunk = chunk_from_fixture(&fixture);
            let naadf = build_naadf_chunk(&chunk, NaadfBuildOptions::default());
            let rays = sun_visibility_rays(&fixture);
            let cpu = NaadfCpuRayBackend::new([naadf.clone()]);
            let expected = rays
                .iter()
                .map(|ray| {
                    let hit = cpu
                        .trace_with_stats(
                            ray.origin(),
                            ray.direction(),
                            ray.max_distance(),
                            VoxelRayPurpose::SunVisibility,
                        )
                        .0;
                    u32::from(hit.is_none())
                })
                .collect::<Vec<_>>();
            let actual = pollster::block_on(dispatch_gpu_sun_visibility(
                &gpu,
                &naadf,
                &rays,
                &fixture.name,
            ));

            assert_eq!(
                expected, actual,
                "NAADF GPU sun visibility mismatch: fixture={}, rays={:?}, expected_clear_flags={:?}, actual_clear_flags={:?}",
                fixture.name, rays, expected, actual
            );
        }
    }

    impl GpuContext {
        async fn new() -> Option<Self> {
            let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::default());
            let adapter = instance
                .request_adapter(&wgpu::RequestAdapterOptions {
                    power_preference: wgpu::PowerPreference::HighPerformance,
                    compatible_surface: None,
                    force_fallback_adapter: false,
                })
                .await
                .ok()?;
            let (device, queue) = adapter
                .request_device(&wgpu::DeviceDescriptor {
                    label: Some("naadf_gpu_layout_test_device"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::default(),
                    experimental_features: wgpu::ExperimentalFeatures::disabled(),
                    memory_hints: wgpu::MemoryHints::Performance,
                    trace: wgpu::Trace::Off,
                })
                .await
                .ok()?;
            Some(Self { device, queue })
        }
    }

    struct GpuBuildOutput {
        chunk_record: [u32; NAADF_PACKED_CHUNK_WORDS],
        block_records: Vec<[u32; NAADF_PACKED_BLOCK_WORDS]>,
        voxel_records: Vec<u32>,
        material_records: Vec<u32>,
        mip_traversal_records: Vec<u32>,
        mip_payload_records: Vec<u32>,
        mip_bounds_records: Vec<u32>,
    }

    impl SunVisibilityRayInput {
        fn new(origin: Vec3, direction: Vec3, max_distance: f32) -> Self {
            let direction = direction.normalize_or_zero();
            Self {
                origin_max_distance: [origin.x, origin.y, origin.z, max_distance],
                direction_purpose: [
                    direction.x,
                    direction.y,
                    direction.z,
                    VoxelRayPurpose::SunVisibility as u32 as f32,
                ],
            }
        }

        fn origin(self) -> Vec3 {
            Vec3::new(
                self.origin_max_distance[0],
                self.origin_max_distance[1],
                self.origin_max_distance[2],
            )
        }

        fn direction(self) -> Vec3 {
            Vec3::new(
                self.direction_purpose[0],
                self.direction_purpose[1],
                self.direction_purpose[2],
            )
        }

        fn max_distance(self) -> f32 {
            self.origin_max_distance[3]
        }
    }

    async fn dispatch_gpu_build(gpu: &GpuContext, chunk: &Chunk, label: &str) -> GpuBuildOutput {
        let raw_voxel_records = raw_records_for_chunk(chunk);
        let chunk_record = initial_chunk_record(chunk.position());
        let chunk_lookup_record = [
            i32_to_u32_bits(chunk.position().x),
            i32_to_u32_bits(chunk.position().y),
            i32_to_u32_bits(chunk.position().z),
            0,
        ];
        let params = [1u32, 1u32, 0u32, 0u32];

        let voxel_buffer = storage_buffer(&gpu.device, "naadf_test_voxels", VOXEL_BYTES);
        let material_buffer = storage_buffer(&gpu.device, "naadf_test_materials", VOXEL_BYTES);
        let raw_buffer = init_storage_buffer(
            &gpu.device,
            "naadf_test_raw_voxels",
            bytemuck::cast_slice(&raw_voxel_records),
        );
        let block_buffer = storage_buffer(&gpu.device, "naadf_test_blocks", BLOCK_BYTES);
        let mip_traversal_buffer =
            storage_buffer(&gpu.device, "naadf_test_mip_traversal", MIP_BYTES);
        let mip_payload_buffer = storage_buffer(&gpu.device, "naadf_test_mip_payload", MIP_BYTES);
        let mip_bounds_buffer = storage_buffer(&gpu.device, "naadf_test_mip_bounds", MIP_BYTES);
        let chunk_buffer = init_storage_buffer(
            &gpu.device,
            "naadf_test_chunks",
            bytemuck::cast_slice(&[chunk_record]),
        );
        let lookup_buffer = init_storage_buffer(
            &gpu.device,
            "naadf_test_chunk_lookup",
            bytemuck::cast_slice(&[chunk_lookup_record]),
        );
        let params_buffer = gpu
            .device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("naadf_test_chunk_bounds_params"),
                contents: bytemuck::cast_slice(&params),
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            });
        let build_slot_buffer = init_storage_buffer(
            &gpu.device,
            "naadf_test_build_slots",
            bytemuck::cast_slice(&[0u32]),
        );

        run_build_blocks(
            gpu,
            &voxel_buffer,
            &material_buffer,
            &raw_buffer,
            &block_buffer,
            &mip_traversal_buffer,
            &mip_payload_buffer,
            &mip_bounds_buffer,
            &build_slot_buffer,
        );
        run_build_mips(
            gpu,
            &mip_traversal_buffer,
            &mip_payload_buffer,
            &mip_bounds_buffer,
            &build_slot_buffer,
        );
        run_build_bounds(gpu, &block_buffer, &build_slot_buffer);
        run_build_chunks(gpu, &block_buffer, &chunk_buffer, &build_slot_buffer);
        run_build_chunk_bounds(
            gpu,
            &chunk_buffer,
            &params_buffer,
            &lookup_buffer,
            &build_slot_buffer,
        );

        let chunk_words = read_words(gpu, &chunk_buffer, CHUNK_BYTES).await;
        let block_words = read_words(gpu, &block_buffer, BLOCK_BYTES).await;
        let voxel_records = read_words(gpu, &voxel_buffer, VOXEL_BYTES).await;
        let material_records = read_words(gpu, &material_buffer, VOXEL_BYTES).await;
        let mip_traversal_records = read_words(gpu, &mip_traversal_buffer, MIP_BYTES).await;
        let mip_payload_records = read_words(gpu, &mip_payload_buffer, MIP_BYTES).await;
        let mip_bounds_records = read_words(gpu, &mip_bounds_buffer, MIP_BYTES).await;

        let chunk_record = chunk_words
            .try_into()
            .unwrap_or_else(|_| panic!("{label}: GPU chunk record has wrong length"));
        let block_records = block_words
            .chunks_exact(NAADF_PACKED_BLOCK_WORDS)
            .map(|chunk| chunk.try_into().unwrap())
            .collect();

        GpuBuildOutput {
            chunk_record,
            block_records,
            voxel_records,
            material_records,
            mip_traversal_records,
            mip_payload_records,
            mip_bounds_records,
        }
    }

    async fn dispatch_gpu_sun_visibility(
        gpu: &GpuContext,
        naadf: &voxel_builder::rendering::naadf::layout::NaadfChunk,
        rays: &[SunVisibilityRayInput],
        _label: &str,
    ) -> Vec<u32> {
        let upload = pack_naadf_chunk_upload(naadf, 0);
        let chunk_lookup_record = [
            i32_to_u32_bits(naadf.position.x),
            i32_to_u32_bits(naadf.position.y),
            i32_to_u32_bits(naadf.position.z),
            0,
        ];
        let params = [rays.len() as u32, SUN_VISIBILITY_MAX_STEPS, 1u32, 1u32];

        let voxel_buffer = init_storage_buffer(
            &gpu.device,
            "naadf_sun_test_voxels",
            bytemuck::cast_slice(&upload.voxel_records),
        );
        let material_buffer = init_storage_buffer(
            &gpu.device,
            "naadf_sun_test_materials",
            bytemuck::cast_slice(&upload.material_records),
        );
        let block_buffer = init_storage_buffer(
            &gpu.device,
            "naadf_sun_test_blocks",
            bytemuck::cast_slice(&upload.block_records),
        );
        let chunk_buffer = init_storage_buffer(
            &gpu.device,
            "naadf_sun_test_chunks",
            bytemuck::cast_slice(&[upload.chunk_record]),
        );
        let lookup_buffer = init_storage_buffer(
            &gpu.device,
            "naadf_sun_test_chunk_lookup",
            bytemuck::cast_slice(&[chunk_lookup_record]),
        );
        let ray_buffer = init_storage_buffer(
            &gpu.device,
            "naadf_sun_test_rays",
            bytemuck::cast_slice(rays),
        );
        let output_buffer = storage_buffer(
            &gpu.device,
            "naadf_sun_test_visibility",
            rays.len() as u64 * 4,
        );
        let params_buffer = gpu
            .device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("naadf_sun_test_params"),
                contents: bytemuck::cast_slice(&params),
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            });

        let layout = gpu
            .device
            .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("naadf_sun_test_layout"),
                entries: &[
                    storage_entry(0, true),
                    storage_entry(1, true),
                    storage_entry(2, true),
                    storage_entry(3, false),
                    uniform_entry(4),
                    storage_entry(5, true),
                    storage_entry(11, true),
                    storage_entry(20, true),
                ],
            });
        let group = gpu.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("naadf_sun_test_group"),
            layout: &layout,
            entries: &[
                buffer_entry(0, &voxel_buffer),
                buffer_entry(1, &material_buffer),
                buffer_entry(2, &ray_buffer),
                buffer_entry(3, &output_buffer),
                buffer_entry(4, &params_buffer),
                buffer_entry(5, &block_buffer),
                buffer_entry(11, &chunk_buffer),
                buffer_entry(20, &lookup_buffer),
            ],
        });
        dispatch_shader(
            gpu,
            "sun_visibility_test",
            sun_visibility_test_shader(),
            "sun_visibility_test",
            &layout,
            &group,
            (rays.len() as u32).div_ceil(64),
        );

        read_words(gpu, &output_buffer, rays.len() as u64 * 4).await
    }

    fn run_build_blocks(
        gpu: &GpuContext,
        voxel_buffer: &wgpu::Buffer,
        material_buffer: &wgpu::Buffer,
        raw_buffer: &wgpu::Buffer,
        block_buffer: &wgpu::Buffer,
        mip_traversal_buffer: &wgpu::Buffer,
        mip_payload_buffer: &wgpu::Buffer,
        mip_bounds_buffer: &wgpu::Buffer,
        build_slot_buffer: &wgpu::Buffer,
    ) {
        let layout = gpu
            .device
            .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("naadf_test_build_blocks_layout"),
                entries: &layout_entries(NAADF_BUILD_BLOCKS_LAYOUT),
            });
        let group = gpu.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("naadf_test_build_blocks_group"),
            layout: &layout,
            entries: &[
                buffer_entry(0, voxel_buffer),
                buffer_entry(1, material_buffer),
                buffer_entry(4, raw_buffer),
                buffer_entry(5, block_buffer),
                buffer_entry(6, mip_traversal_buffer),
                buffer_entry(7, mip_payload_buffer),
                buffer_entry(8, mip_bounds_buffer),
                buffer_entry(30, build_slot_buffer),
            ],
        });
        dispatch_shader(
            gpu,
            "build_blocks",
            resolve_shader(include_str!("../assets/shaders/naadf/build_blocks.wgsl")),
            "build_naadf_blocks",
            &layout,
            &group,
            64,
        );
    }

    fn run_build_mips(
        gpu: &GpuContext,
        mip_traversal_buffer: &wgpu::Buffer,
        mip_payload_buffer: &wgpu::Buffer,
        mip_bounds_buffer: &wgpu::Buffer,
        build_slot_buffer: &wgpu::Buffer,
    ) {
        let layout = gpu
            .device
            .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("naadf_test_build_mips_layout"),
                entries: &layout_entries(NAADF_BUILD_MIPS_LAYOUT),
            });
        let group = gpu.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("naadf_test_build_mips_group"),
            layout: &layout,
            entries: &[
                buffer_entry(6, mip_traversal_buffer),
                buffer_entry(7, mip_payload_buffer),
                buffer_entry(8, mip_bounds_buffer),
                buffer_entry(30, build_slot_buffer),
            ],
        });
        dispatch_shader(
            gpu,
            "build_mips",
            resolve_shader(include_str!("../assets/shaders/naadf/build_mips.wgsl")),
            "build_naadf_mips",
            &layout,
            &group,
            1,
        );
    }

    fn run_build_bounds(
        gpu: &GpuContext,
        block_buffer: &wgpu::Buffer,
        build_slot_buffer: &wgpu::Buffer,
    ) {
        let layout = gpu
            .device
            .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("naadf_test_build_bounds_layout"),
                entries: &layout_entries(NAADF_BUILD_BOUNDS_LAYOUT),
            });
        let group = gpu.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("naadf_test_build_bounds_group"),
            layout: &layout,
            entries: &[
                buffer_entry(5, block_buffer),
                buffer_entry(30, build_slot_buffer),
            ],
        });
        dispatch_shader(
            gpu,
            "build_bounds",
            resolve_shader(include_str!("../assets/shaders/naadf/build_bounds.wgsl")),
            "build_naadf_bounds",
            &layout,
            &group,
            1,
        );
    }

    fn run_build_chunks(
        gpu: &GpuContext,
        block_buffer: &wgpu::Buffer,
        chunk_buffer: &wgpu::Buffer,
        build_slot_buffer: &wgpu::Buffer,
    ) {
        let layout = gpu
            .device
            .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("naadf_test_build_chunks_layout"),
                entries: &layout_entries(NAADF_BUILD_CHUNKS_LAYOUT),
            });
        let group = gpu.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("naadf_test_build_chunks_group"),
            layout: &layout,
            entries: &[
                buffer_entry(5, block_buffer),
                buffer_entry(11, chunk_buffer),
                buffer_entry(30, build_slot_buffer),
            ],
        });
        dispatch_shader(
            gpu,
            "build_chunks",
            resolve_shader(include_str!("../assets/shaders/naadf/build_chunks.wgsl")),
            "build_naadf_chunks",
            &layout,
            &group,
            1,
        );
    }

    fn run_build_chunk_bounds(
        gpu: &GpuContext,
        chunk_buffer: &wgpu::Buffer,
        params_buffer: &wgpu::Buffer,
        lookup_buffer: &wgpu::Buffer,
        build_slot_buffer: &wgpu::Buffer,
    ) {
        let layout = gpu
            .device
            .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("naadf_test_build_chunk_bounds_layout"),
                entries: &layout_entries(NAADF_BUILD_CHUNK_BOUNDS_LAYOUT),
            });
        let group = gpu.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("naadf_test_build_chunk_bounds_group"),
            layout: &layout,
            entries: &[
                buffer_entry(11, chunk_buffer),
                buffer_entry(12, params_buffer),
                buffer_entry(20, lookup_buffer),
                buffer_entry(30, build_slot_buffer),
            ],
        });
        dispatch_shader(
            gpu,
            "build_chunk_bounds",
            resolve_shader(include_str!(
                "../assets/shaders/naadf/build_chunk_bounds.wgsl"
            )),
            "build_naadf_chunk_bounds",
            &layout,
            &group,
            1,
        );
    }

    fn dispatch_shader(
        gpu: &GpuContext,
        label: &'static str,
        source: String,
        entry_point: &'static str,
        group3_layout: &wgpu::BindGroupLayout,
        group3: &wgpu::BindGroup,
        workgroups_x: u32,
    ) {
        let shader = gpu
            .device
            .create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some(label),
                source: wgpu::ShaderSource::Wgsl(source.into()),
            });
        let empty_layouts = [
            gpu.device
                .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                    label: Some("naadf_test_empty_0"),
                    entries: &[],
                }),
            gpu.device
                .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                    label: Some("naadf_test_empty_1"),
                    entries: &[],
                }),
            gpu.device
                .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                    label: Some("naadf_test_empty_2"),
                    entries: &[],
                }),
        ];
        let empty_groups = [
            gpu.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("naadf_test_empty_group_0"),
                layout: &empty_layouts[0],
                entries: &[],
            }),
            gpu.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("naadf_test_empty_group_1"),
                layout: &empty_layouts[1],
                entries: &[],
            }),
            gpu.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("naadf_test_empty_group_2"),
                layout: &empty_layouts[2],
                entries: &[],
            }),
        ];
        let pipeline_layout = gpu
            .device
            .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some(label),
                bind_group_layouts: &[
                    &empty_layouts[0],
                    &empty_layouts[1],
                    &empty_layouts[2],
                    group3_layout,
                ],
                push_constant_ranges: &[],
            });
        let pipeline = gpu
            .device
            .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some(label),
                layout: Some(&pipeline_layout),
                module: &shader,
                entry_point: Some(entry_point),
                compilation_options: Default::default(),
                cache: None,
            });
        let mut encoder = gpu
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some(label) });
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some(label),
                timestamp_writes: None,
            });
            pass.set_pipeline(&pipeline);
            pass.set_bind_group(0, &empty_groups[0], &[]);
            pass.set_bind_group(1, &empty_groups[1], &[]);
            pass.set_bind_group(2, &empty_groups[2], &[]);
            pass.set_bind_group(3, group3, &[]);
            pass.dispatch_workgroups(workgroups_x, 1, 1);
        }
        gpu.queue.submit(Some(encoder.finish()));
        let _ = gpu.device.poll(wgpu::PollType::wait_indefinitely());
    }

    async fn read_words(gpu: &GpuContext, source: &wgpu::Buffer, size: u64) -> Vec<u32> {
        let readback = gpu.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("naadf_test_readback"),
            size,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut encoder = gpu
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("naadf_test_readback_encoder"),
            });
        encoder.copy_buffer_to_buffer(source, 0, &readback, 0, size);
        gpu.queue.submit(Some(encoder.finish()));

        let slice = readback.slice(..);
        let (sender, receiver) = mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |result| {
            sender.send(result).unwrap();
        });
        let _ = gpu.device.poll(wgpu::PollType::wait_indefinitely());
        receiver.recv().unwrap().unwrap();

        let data = slice.get_mapped_range();
        let words = bytemuck::cast_slice(&data).to_vec();
        drop(data);
        readback.unmap();
        words
    }

    fn storage_buffer(device: &wgpu::Device, label: &'static str, size: u64) -> wgpu::Buffer {
        device.create_buffer(&wgpu::BufferDescriptor {
            label: Some(label),
            size,
            usage: wgpu::BufferUsages::STORAGE
                | wgpu::BufferUsages::COPY_DST
                | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        })
    }

    fn init_storage_buffer(
        device: &wgpu::Device,
        label: &'static str,
        contents: &[u8],
    ) -> wgpu::Buffer {
        device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some(label),
            contents,
            usage: wgpu::BufferUsages::STORAGE
                | wgpu::BufferUsages::COPY_DST
                | wgpu::BufferUsages::COPY_SRC,
        })
    }

    fn storage_entry(binding: u32, read_only: bool) -> wgpu::BindGroupLayoutEntry {
        wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Storage { read_only },
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            count: None,
        }
    }

    fn layout_entries(specs: &[NaadfBindEntrySpec]) -> Vec<wgpu::BindGroupLayoutEntry> {
        specs
            .iter()
            .map(|spec| match spec.kind {
                NaadfBindEntryKind::StorageRead => storage_entry(spec.binding, true),
                NaadfBindEntryKind::StorageReadWrite => storage_entry(spec.binding, false),
                NaadfBindEntryKind::Uniform => uniform_entry(spec.binding),
            })
            .collect()
    }

    fn uniform_entry(binding: u32) -> wgpu::BindGroupLayoutEntry {
        wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Uniform,
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            count: None,
        }
    }

    fn buffer_entry(binding: u32, buffer: &wgpu::Buffer) -> wgpu::BindGroupEntry<'_> {
        wgpu::BindGroupEntry {
            binding,
            resource: buffer.as_entire_binding(),
        }
    }

    fn resolve_shader(source: &str) -> String {
        let common = include_str!("../assets/shaders/naadf/common.wgsl");
        let layout = strip_imports(include_str!("../assets/shaders/naadf/layout.wgsl"));
        let mut resolved = String::new();
        for line in source.lines() {
            let trimmed = line.trim_start();
            if trimmed.starts_with("#import") {
                if trimmed.contains("common") {
                    resolved.push_str(common);
                    resolved.push('\n');
                } else if trimmed.contains("layout") {
                    resolved.push_str(&layout);
                    resolved.push('\n');
                }
            } else {
                resolved.push_str(line);
                resolved.push('\n');
            }
        }
        resolved
    }

    fn sun_visibility_test_shader() -> String {
        let common = include_str!("../assets/shaders/naadf/common.wgsl");
        let layout = strip_imports(include_str!("../assets/shaders/naadf/layout.wgsl"));
        let ray_trace = strip_imports(include_str!("../assets/shaders/naadf/ray_trace.wgsl"));
        let world_trace = strip_imports(include_str!("../assets/shaders/naadf/world_trace.wgsl"));
        let lighting_queries = strip_imports(include_str!(
            "../assets/shaders/naadf/lighting_queries.wgsl"
        ));
        format!(
            "{common}\n{layout}\n{ray_trace}\n{world_trace}\n{lighting_queries}\n{}",
            r#"
struct SunVisibilityRayInput {
    origin_max_distance: vec4<f32>,
    direction_purpose: vec4<f32>,
}

struct SunVisibilityParams {
    ray_count: u32,
    max_steps: u32,
    chunk_count: u32,
    chunk_lookup_count: u32,
}

@group(3) @binding(2) var<storage, read> sun_visibility_ray_inputs: array<SunVisibilityRayInput>;
@group(3) @binding(3) var<storage, read_write> sun_visibility_ray_outputs: array<u32>;
@group(3) @binding(4) var<uniform> sun_visibility_params: SunVisibilityParams;

@compute @workgroup_size(64)
fn sun_visibility_test(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let index = global_id.x;
    if index >= sun_visibility_params.ray_count {
        return;
    }

    let input = sun_visibility_ray_inputs[index];
    let visibility = naadf_sun_visibility_world(
        input.origin_max_distance.xyz,
        input.direction_purpose.xyz,
        input.origin_max_distance.w,
        sun_visibility_params.max_steps,
        sun_visibility_params.chunk_count,
        sun_visibility_params.chunk_lookup_count,
    );
    sun_visibility_ray_outputs[index] = select(0u, 1u, visibility > 0.5);
}
"#
        )
    }

    fn strip_imports(source: &str) -> String {
        source
            .lines()
            .filter(|line| !line.trim_start().starts_with("#import"))
            .collect::<Vec<_>>()
            .join("\n")
    }

    fn raw_records_for_chunk(chunk: &Chunk) -> Vec<u32> {
        let mut records = vec![0u32; CHUNK_VOLUME];
        for (local, voxel) in chunk.iter() {
            let material_id = material_id_for_voxel(voxel);
            records[voxel_index_in_chunk(local)] =
                pack_raw_voxel_record(material_id != 0, material_id);
        }
        records
    }

    fn material_id_for_voxel(voxel: VoxelType) -> u16 {
        if voxel.is_solid() { voxel as u16 } else { 0 }
    }

    fn initial_chunk_record(position: IVec3) -> [u32; NAADF_PACKED_CHUNK_WORDS] {
        [
            0,
            i32_to_u32_bits(position.x),
            i32_to_u32_bits(position.y),
            i32_to_u32_bits(position.z),
            BLOCKS_PER_CHUNK,
            CHUNK_VOLUME as u32,
            0,
            0,
        ]
    }

    fn assert_records_eq<T: PartialEq + std::fmt::Debug>(
        fixture: &str,
        chunk_pos: IVec3,
        kind: &str,
        expected: &T,
        actual: &T,
    ) {
        assert_eq!(
            expected, actual,
            "NAADF GPU record mismatch: fixture={fixture}, chunk_pos={chunk_pos:?}, kind={kind}, expected={expected:?}, actual={actual:?}"
        );
    }

    fn assert_base_mip_records_match_raw(
        fixture: &str,
        raw_voxel_records: &[u32],
        mip_traversal_records: &[u32],
        mip_payload_records: &[u32],
    ) {
        for (index, raw) in raw_voxel_records.iter().copied().enumerate() {
            let mip_index = index;
            let occupied = (raw & 0x8000_0000) != 0;
            let expected_state = if occupied {
                NaadfNodeState::UniformFull
            } else {
                NaadfNodeState::UniformEmpty
            } as u32;
            let actual_state = mip_traversal_records[mip_index] >> TRAVERSAL_RECORD_STATE_SHIFT;
            let actual_child_mask = mip_traversal_records[mip_index] & 0xff;

            assert_eq!(
                expected_state, actual_state,
                "{fixture}: base mip state mismatch at voxel index {index}"
            );
            assert_eq!(
                u32::from(occupied),
                actual_child_mask,
                "{fixture}: base mip child mask mismatch at voxel index {index}"
            );
            assert_eq!(
                raw & 0x0000_ffff,
                mip_payload_records[mip_index],
                "{fixture}: base mip payload mismatch at voxel index {index}"
            );
        }
    }

    fn naadf_fixture_files() -> [(&'static str, &'static str); 10] {
        [
            (
                "empty_chunk.ron",
                include_str!("fixtures/naadf/empty_chunk.ron"),
            ),
            (
                "full_chunk.ron",
                include_str!("fixtures/naadf/full_chunk.ron"),
            ),
            (
                "single_voxel.ron",
                include_str!("fixtures/naadf/single_voxel.ron"),
            ),
            ("wall_x.ron", include_str!("fixtures/naadf/wall_x.ron")),
            ("wall_y.ron", include_str!("fixtures/naadf/wall_y.ron")),
            ("wall_z.ron", include_str!("fixtures/naadf/wall_z.ron")),
            (
                "staircase.ron",
                include_str!("fixtures/naadf/staircase.ron"),
            ),
            ("tunnel.ron", include_str!("fixtures/naadf/tunnel.ron")),
            (
                "chunk_boundary.ron",
                include_str!("fixtures/naadf/chunk_boundary.ron"),
            ),
            (
                "bedrock_floor.ron",
                include_str!("fixtures/naadf/bedrock_floor.ron"),
            ),
        ]
    }

    fn chunk_from_fixture(fixture: &NaadfFixture) -> Chunk {
        let mut chunk = Chunk::new(IVec3::ZERO);
        if let Some(fill) = fixture.fill.as_deref() {
            let voxel = voxel_from_name(fill);
            for z in 0..16 {
                for y in 0..16 {
                    for x in 0..16 {
                        chunk.set(UVec3::new(x, y, z), voxel);
                    }
                }
            }
        }
        if let Some(empty_rule) = fixture.empty_rule.as_deref() {
            apply_rule(&mut chunk, empty_rule, VoxelType::Air);
        }
        if let Some(occupied_rule) = fixture.occupied_rule.as_deref() {
            apply_rule(&mut chunk, occupied_rule, VoxelType::Rock);
        }
        for (local, voxel) in &fixture.occupied {
            chunk.set(uvec3_from_fixture(local), voxel_from_name(voxel));
        }
        chunk
    }

    fn apply_rule(chunk: &mut Chunk, rule: &str, voxel: VoxelType) {
        for z in 0..16 {
            for y in 0..16 {
                for x in 0..16 {
                    if rule_matches(rule, x, y, z) {
                        chunk.set(UVec3::new(x, y, z), voxel);
                    }
                }
            }
        }
    }

    fn rule_matches(rule: &str, x: u32, y: u32, z: u32) -> bool {
        match rule {
            "x == 8" => x == 8,
            "y == 8" => y == 8,
            "z == 8" => z == 8,
            "x == y && z == 4" => x == y && z == 4,
            "y == 8 && z == 8" => y == 8 && z == 8,
            "y == 0" => y == 0,
            other => panic!("unsupported NAADF fixture rule: {other}"),
        }
    }

    fn voxel_from_name(name: &str) -> VoxelType {
        match name {
            "air" => VoxelType::Air,
            "rock" => VoxelType::Rock,
            "bedrock" => VoxelType::Bedrock,
            "water" => VoxelType::Water,
            other => panic!("unsupported fixture voxel type: {other}"),
        }
    }

    fn uvec3_from_fixture(value: &[u32]) -> UVec3 {
        assert_eq!(value.len(), 3, "fixture vector must have exactly 3 values");
        UVec3::new(value[0], value[1], value[2])
    }

    fn vec3_from_fixture(value: &[f32]) -> Vec3 {
        assert_eq!(value.len(), 3, "fixture vector must have exactly 3 values");
        Vec3::new(value[0], value[1], value[2])
    }

    fn sun_visibility_rays(fixture: &NaadfFixture) -> Vec<SunVisibilityRayInput> {
        let sun_dirs = [
            Vec3::new(-0.35, 0.85, -0.25).normalize(),
            Vec3::new(0.45, 0.75, 0.48).normalize(),
            Vec3::new(-0.2, 0.95, 0.05).normalize(),
        ];
        let mut origins = vec![
            Vec3::new(0.5, 0.5, 0.5),
            Vec3::new(8.5, 8.5, 8.5),
            Vec3::new(15.5, 1.5, 15.5),
        ];
        origins.extend(
            fixture
                .rays
                .iter()
                .map(|ray| vec3_from_fixture(&ray.origin)),
        );

        let mut rays = Vec::new();
        for origin in origins {
            for direction in sun_dirs {
                rays.push(SunVisibilityRayInput::new(origin, direction, 48.0));
            }
        }
        for fixture_ray in &fixture.rays {
            rays.push(SunVisibilityRayInput::new(
                vec3_from_fixture(&fixture_ray.origin),
                vec3_from_fixture(&fixture_ray.dir),
                fixture_ray.max_distance,
            ));
        }
        rays
    }

    fn i32_to_u32_bits(value: i32) -> u32 {
        u32::from_ne_bytes(value.to_ne_bytes())
    }
}

#[cfg(not(feature = "naadf"))]
#[test]
fn naadf_gpu_layout_tests_are_feature_gated() {
    assert!(true);
}
