#[cfg(feature = "naadf")]
mod naadf_gpu_layout {
    use bevy::prelude::*;
    use serde::Deserialize;
    use std::sync::mpsc;
    use voxel_builder::constants::CHUNK_VOLUME;
    use voxel_builder::rendering::naadf::cpu_builder::{NaadfBuildOptions, build_naadf_chunk};
    use voxel_builder::rendering::naadf::gpu_buffers::{
        NAADF_PACKED_BLOCK_WORDS, NAADF_PACKED_CHUNK_WORDS, pack_naadf_chunk_upload,
        pack_raw_voxel_record,
    };
    use voxel_builder::rendering::naadf::layout::BLOCKS_PER_CHUNK;
    use voxel_builder::rendering::naadf::layout::voxel_index_in_chunk;
    use voxel_builder::voxel::chunk::Chunk;
    use voxel_builder::voxel::types::{Voxel, VoxelType};
    use wgpu::util::DeviceExt;

    const VOXEL_BYTES: u64 = CHUNK_VOLUME as u64 * 4;
    const BLOCK_BYTES: u64 = BLOCKS_PER_CHUNK as u64 * NAADF_PACKED_BLOCK_WORDS as u64 * 4;
    const CHUNK_BYTES: u64 = NAADF_PACKED_CHUNK_WORDS as u64 * 4;
    const LOOKUP_BYTES: u64 = 16;
    const PARAM_BYTES: u64 = 16;

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

    struct GpuContext {
        device: wgpu::Device,
        queue: wgpu::Queue,
    }

    #[test]
    fn gpu_build_dispatch_matches_cpu_upload_for_all_fixtures() {
        let Some(gpu) = pollster::block_on(GpuContext::new()) else {
            eprintln!("skipping NAADF GPU layout dispatch test: no headless wgpu adapter");
            return;
        };

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

        run_build_blocks(
            gpu,
            &voxel_buffer,
            &material_buffer,
            &raw_buffer,
            &block_buffer,
        );
        run_build_bounds(gpu, &block_buffer);
        run_build_chunks(gpu, &block_buffer, &chunk_buffer);
        run_build_chunk_bounds(gpu, &chunk_buffer, &params_buffer, &lookup_buffer);

        let chunk_words = read_words(gpu, &chunk_buffer, CHUNK_BYTES).await;
        let block_words = read_words(gpu, &block_buffer, BLOCK_BYTES).await;
        let voxel_records = read_words(gpu, &voxel_buffer, VOXEL_BYTES).await;
        let material_records = read_words(gpu, &material_buffer, VOXEL_BYTES).await;

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
        }
    }

    fn run_build_blocks(
        gpu: &GpuContext,
        voxel_buffer: &wgpu::Buffer,
        material_buffer: &wgpu::Buffer,
        raw_buffer: &wgpu::Buffer,
        block_buffer: &wgpu::Buffer,
    ) {
        let layout = gpu
            .device
            .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("naadf_test_build_blocks_layout"),
                entries: &[
                    storage_entry(0, false),
                    storage_entry(1, false),
                    storage_entry(4, true),
                    storage_entry(5, false),
                ],
            });
        let group = gpu.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("naadf_test_build_blocks_group"),
            layout: &layout,
            entries: &[
                buffer_entry(0, voxel_buffer),
                buffer_entry(1, material_buffer),
                buffer_entry(4, raw_buffer),
                buffer_entry(5, block_buffer),
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

    fn run_build_bounds(gpu: &GpuContext, block_buffer: &wgpu::Buffer) {
        let layout = gpu
            .device
            .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("naadf_test_build_bounds_layout"),
                entries: &[storage_entry(5, false)],
            });
        let group = gpu.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("naadf_test_build_bounds_group"),
            layout: &layout,
            entries: &[buffer_entry(5, block_buffer)],
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
    ) {
        let layout = gpu
            .device
            .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("naadf_test_build_chunks_layout"),
                entries: &[storage_entry(5, true), storage_entry(11, false)],
            });
        let group = gpu.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("naadf_test_build_chunks_group"),
            layout: &layout,
            entries: &[
                buffer_entry(5, block_buffer),
                buffer_entry(11, chunk_buffer),
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
    ) {
        let layout = gpu
            .device
            .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("naadf_test_build_chunk_bounds_layout"),
                entries: &[
                    storage_entry(11, false),
                    uniform_entry(12),
                    storage_entry(20, true),
                ],
            });
        let group = gpu.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("naadf_test_build_chunk_bounds_group"),
            layout: &layout,
            entries: &[
                buffer_entry(11, chunk_buffer),
                buffer_entry(12, params_buffer),
                buffer_entry(20, lookup_buffer),
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
        let layout = include_str!("../assets/shaders/naadf/layout.wgsl")
            .lines()
            .filter(|line| !line.trim_start().starts_with("#import"))
            .collect::<Vec<_>>()
            .join("\n");
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

    fn i32_to_u32_bits(value: i32) -> u32 {
        u32::from_ne_bytes(value.to_ne_bytes())
    }
}

#[cfg(not(feature = "naadf"))]
#[test]
fn naadf_gpu_layout_tests_are_feature_gated() {
    assert!(true);
}
