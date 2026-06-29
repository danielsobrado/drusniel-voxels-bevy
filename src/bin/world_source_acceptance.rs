use std::path::PathBuf;
use std::process::ExitCode;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use bevy::prelude::{IVec3, UVec3};
use clap::Parser;
use serde::Serialize;
use voxel_builder::constants::{CHUNK_SIZE, CHUNK_SIZE_I32, CHUNK_VOLUME};
use voxel_builder::rendering::ao_config::BakedAoConfig;
use voxel_builder::voxel::chunk::{Chunk, LodLevel};
use voxel_builder::voxel::materials::MaterialId;
use voxel_builder::voxel::meshing::{
    MeshForensicsOptions, MeshMode, MeshRequest, WaterAirExposureMode,
    generate_chunk_mesh_for_request,
};
use voxel_builder::voxel::skirt::NeighborLods;
use voxel_builder::voxel::types::VoxelType;
use voxel_builder::voxel::world::VoxelWorld;
use voxel_builder::world::source::{
    ProceduralWorldSourceTerrainBridge, TerrainSourceConfig, TerrainSourceStartupReport,
    UnavailableWorldSourceGpuReadback, WorldSourceDriftGateConfig, WorldSourceDriftGateReport,
    WorldSourceDriftSamplePoint, WorldSourceGpuReadbackProvider, WorldSourceGpuReadbackResult,
    evaluate_world_source_cpu_gpu_drift, material_with_biome,
};

const DEFAULT_SAMPLE_CHUNKS: [IVec3; 4] = [
    IVec3::new(0, 0, 0),
    IVec3::new(1, 0, 0),
    IVec3::new(0, 1, 1),
    IVec3::new(1, 1, 1),
];
const WORLD_SIZE_CHUNKS: IVec3 = IVec3::new(2, 2, 2);
const RELEASE_COMMAND: &str = "cargo run --release --bin world_source_acceptance";

#[derive(Parser, Debug)]
#[command(
    about = "Write a WorldSource GPU-first acceptance summary.json",
    version
)]
struct Args {
    #[arg(long, default_value = "bench-runs")]
    output_root: PathBuf,

    #[arg(long)]
    run_name: Option<String>,

    #[arg(long, default_value_t = false)]
    blocky: bool,
}

#[derive(Debug, Serialize)]
struct AcceptanceSummary {
    schema_version: u32,
    run_name: String,
    build_profile: String,
    release_mode: bool,
    release_command: &'static str,
    terrain_source: TerrainSourceStartupReport,
    chunk_generation: ChunkGenerationBenchSummary,
    mesh_build: MeshBuildBenchSummary,
    material_draw_impact: MaterialDrawImpactSummary,
    gpu_readback: WorldSourceGpuReadbackResult,
    drift_gate: WorldSourceDriftGateReport,
    output_path: String,
}

#[derive(Debug, Serialize)]
struct ChunkGenerationBenchSummary {
    sampled_chunks: usize,
    voxels_generated: usize,
    elapsed_ms: f64,
    avg_chunk_ms: f64,
}

#[derive(Debug, Serialize)]
struct MeshBuildBenchSummary {
    mode: &'static str,
    sampled_chunks: usize,
    elapsed_ms: f64,
    avg_chunk_ms: f64,
    solid_vertices: usize,
    solid_triangles: usize,
    water_vertices: usize,
    water_triangles: usize,
}

#[derive(Debug, Serialize)]
struct MaterialDrawImpactSummary {
    gpu_biome_splat_shader_default: bool,
    compatibility_biome_channel_active: bool,
    estimated_solid_draws: usize,
    estimated_water_draws: usize,
    estimated_total_draws: usize,
    sampled_solid_meshes: usize,
    sampled_water_meshes: usize,
}

fn main() -> ExitCode {
    match run() {
        Ok(path) => {
            println!("Wrote {}", path.display());
            ExitCode::SUCCESS
        }
        Err(err) => {
            eprintln!("error: {err}");
            ExitCode::from(1)
        }
    }
}

fn run() -> Result<PathBuf, String> {
    let args = Args::parse();
    let run_name = args.run_name.unwrap_or_else(default_run_name);
    let output_dir = args.output_root.join(&run_name);
    let output_path = output_dir.join("summary.json");

    let terrain_config = TerrainSourceConfig::load_or_default();
    require_default_gpu_runtime_path(&terrain_config)?;
    let terrain_source = TerrainSourceStartupReport::from_config(&terrain_config);
    let bridge = ProceduralWorldSourceTerrainBridge::load_or_default();

    let (mut world, chunk_generation) = bench_chunk_generation(&bridge);
    let mesh_mode = if args.blocky {
        MeshMode::Blocky
    } else {
        MeshMode::SurfaceNets
    };
    let (mesh_build, material_draw_impact) = bench_mesh_build(&mut world, mesh_mode)?;
    let drift_points = drift_points();
    let gpu_readback = UnavailableWorldSourceGpuReadback.read_world_source_samples(&drift_points);
    let drift_gate = evaluate_world_source_cpu_gpu_drift(
        bridge.source(),
        &drift_points,
        gpu_readback.samples(),
        WorldSourceDriftGateConfig::default(),
    );

    let summary = AcceptanceSummary {
        schema_version: 1,
        run_name,
        build_profile: build_profile().to_string(),
        release_mode: !cfg!(debug_assertions),
        release_command: RELEASE_COMMAND,
        terrain_source,
        chunk_generation,
        mesh_build,
        material_draw_impact,
        gpu_readback,
        drift_gate,
        output_path: output_path.display().to_string(),
    };

    std::fs::create_dir_all(&output_dir)
        .map_err(|err| format!("failed to create {}: {err}", output_dir.display()))?;
    let json = serde_json::to_string_pretty(&summary)
        .map_err(|err| format!("failed to serialize acceptance summary: {err}"))?;
    std::fs::write(&output_path, json)
        .map_err(|err| format!("failed to write {}: {err}", output_path.display()))?;

    Ok(output_path)
}

fn require_default_gpu_runtime_path(config: &TerrainSourceConfig) -> Result<(), String> {
    if config.is_gpu_default_path() {
        return Ok(());
    }

    Err(format!(
        "world_source_acceptance requires terrain_source.mode=gpu_world_source; got {}",
        config.mode.acceptance_label(),
    ))
}

fn bench_chunk_generation(
    bridge: &ProceduralWorldSourceTerrainBridge,
) -> (VoxelWorld, ChunkGenerationBenchSummary) {
    let mut world = VoxelWorld::new(WORLD_SIZE_CHUNKS);
    let started = Instant::now();
    for chunk_pos in DEFAULT_SAMPLE_CHUNKS {
        world.insert_chunk(generate_world_source_chunk(chunk_pos, bridge));
    }
    let elapsed_ms = elapsed_ms(started);
    let sampled_chunks = DEFAULT_SAMPLE_CHUNKS.len();
    (
        world,
        ChunkGenerationBenchSummary {
            sampled_chunks,
            voxels_generated: sampled_chunks * CHUNK_VOLUME,
            elapsed_ms,
            avg_chunk_ms: elapsed_ms / sampled_chunks as f64,
        },
    )
}

fn generate_world_source_chunk(
    chunk_pos: IVec3,
    bridge: &ProceduralWorldSourceTerrainBridge,
) -> Chunk {
    let chunk_world = chunk_pos * CHUNK_SIZE_I32;
    let voxels = std::array::from_fn(|index| {
        let x = index % CHUNK_SIZE;
        let y = (index / CHUNK_SIZE) % CHUNK_SIZE;
        let z = index / (CHUNK_SIZE * CHUNK_SIZE);
        bridge.get_voxel(
            chunk_world.x + x as i32,
            chunk_world.y + y as i32,
            chunk_world.z + z as i32,
        )
    });
    let mut chunk = Chunk::with_voxels(chunk_pos, voxels);
    for z in 0..CHUNK_SIZE {
        for y in 0..CHUNK_SIZE {
            for x in 0..CHUNK_SIZE {
                let local = UVec3::new(x as u32, y as u32, z as u32);
                let voxel = chunk.get(local);
                if voxel == VoxelType::Air || voxel == VoxelType::Water {
                    continue;
                }
                let biome = bridge.biome(chunk_world.x + x as i32, chunk_world.z + z as i32);
                let material = material_with_biome(MaterialId::from_voxel(voxel), biome);
                chunk.set_material_id(local, material);
            }
        }
    }
    chunk
}

fn bench_mesh_build(
    world: &mut VoxelWorld,
    mode: MeshMode,
) -> Result<(MeshBuildBenchSummary, MaterialDrawImpactSummary), String> {
    let ao = BakedAoConfig {
        enabled: true,
        strength: 0.8,
        corner_darkness: 0.6,
        fix_anisotropy: true,
    };
    let started = Instant::now();
    let mut solid_vertices = 0usize;
    let mut solid_triangles = 0usize;
    let mut water_vertices = 0usize;
    let mut water_triangles = 0usize;
    let mut sampled_solid_meshes = 0usize;
    let mut sampled_water_meshes = 0usize;

    for chunk_pos in DEFAULT_SAMPLE_CHUNKS {
        let chunk = world
            .get_chunk(chunk_pos)
            .ok_or_else(|| format!("missing generated chunk {chunk_pos:?}"))?;
        let result = generate_chunk_mesh_for_request(MeshRequest {
            chunk,
            world,
            mode,
            logical_lod: LodLevel::Lod0,
            mesh_lod: LodLevel::Lod0,
            neighbor_lods: NeighborLods::default(),
            ao_config: &ao,
            water_exposure_mode: WaterAirExposureMode::ExteriorConnected,
            forensics: MeshForensicsOptions::default(),
            mc_settings: None,
            timing_enabled: true,
        });

        solid_vertices += result.solid.positions.len();
        solid_triangles += result.solid.indices.len() / 3;
        water_vertices += result.water.positions.len();
        water_triangles += result.water.indices.len() / 3;
        if !result.solid.is_empty() {
            sampled_solid_meshes += 1;
        }
        if !result.water.is_empty() {
            sampled_water_meshes += 1;
        }
    }

    let elapsed_ms = elapsed_ms(started);
    let sampled_chunks = DEFAULT_SAMPLE_CHUNKS.len();
    let estimated_solid_draws = sampled_solid_meshes;
    let estimated_water_draws = sampled_water_meshes;

    Ok((
        MeshBuildBenchSummary {
            mode: mesh_mode_label(mode),
            sampled_chunks,
            elapsed_ms,
            avg_chunk_ms: elapsed_ms / sampled_chunks as f64,
            solid_vertices,
            solid_triangles,
            water_vertices,
            water_triangles,
        },
        MaterialDrawImpactSummary {
            gpu_biome_splat_shader_default: true,
            compatibility_biome_channel_active: false,
            estimated_solid_draws,
            estimated_water_draws,
            estimated_total_draws: estimated_solid_draws + estimated_water_draws,
            sampled_solid_meshes,
            sampled_water_meshes,
        },
    ))
}

fn drift_points() -> [WorldSourceDriftSamplePoint; 5] {
    [
        WorldSourceDriftSamplePoint::new(0.0, 0.0),
        WorldSourceDriftSamplePoint::new(64.0, 64.0),
        WorldSourceDriftSamplePoint::new(128.0, 32.0).with_slope(0.35),
        WorldSourceDriftSamplePoint::new(192.0, 160.0).with_slope(0.7),
        WorldSourceDriftSamplePoint::new(240.0, 24.0),
    ]
}

fn default_run_name() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    format!("world-source-{secs}")
}

fn elapsed_ms(started: Instant) -> f64 {
    started.elapsed().as_secs_f64() * 1000.0
}

fn mesh_mode_label(mode: MeshMode) -> &'static str {
    match mode {
        MeshMode::Blocky => "blocky",
        MeshMode::SurfaceNets => "surface_nets",
        MeshMode::McTransvoxel => "mc_transvoxel",
    }
}

fn build_profile() -> &'static str {
    if cfg!(debug_assertions) {
        "debug"
    } else {
        "release"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use voxel_builder::world::source::TerrainSourceMode;

    #[test]
    fn default_run_name_is_world_source_prefixed() {
        assert!(default_run_name().starts_with("world-source-"));
    }

    #[test]
    fn mesh_mode_labels_are_stable() {
        assert_eq!(mesh_mode_label(MeshMode::SurfaceNets), "surface_nets");
        assert_eq!(mesh_mode_label(MeshMode::Blocky), "blocky");
    }

    #[test]
    fn build_profile_is_stable() {
        assert!(matches!(build_profile(), "debug" | "release"));
    }

    #[test]
    fn acceptance_requires_gpu_world_source_mode() {
        assert!(
            require_default_gpu_runtime_path(&TerrainSourceConfig {
                mode: TerrainSourceMode::GpuWorldSource,
            })
            .is_ok()
        );
        assert!(
            require_default_gpu_runtime_path(&TerrainSourceConfig {
                mode: TerrainSourceMode::Legacy,
            })
            .is_err()
        );
        assert!(
            require_default_gpu_runtime_path(&TerrainSourceConfig {
                mode: TerrainSourceMode::CpuWorldSourceReference,
            })
            .is_err()
        );
    }
}
