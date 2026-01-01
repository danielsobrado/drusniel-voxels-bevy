//! Benchmarks for chunk meshing performance.

use bevy::math::{IVec3, UVec3};
use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};
use voxel_builder::constants::CHUNK_SIZE;
use voxel_builder::voxel::chunk::Chunk;
use voxel_builder::voxel::types::VoxelType;
use voxel_builder::voxel::meshing::MeshData;

/// Create a chunk with a checkerboard pattern for stress testing.
fn create_checkerboard_chunk() -> Chunk {
    let mut chunk = Chunk::new(IVec3::ZERO);
    for x in 0..CHUNK_SIZE {
        for y in 0..CHUNK_SIZE {
            for z in 0..CHUNK_SIZE {
                let is_solid = (x + y + z) % 2 == 0;
                let voxel = if is_solid { VoxelType::Rock } else { VoxelType::Air };
                chunk.set(UVec3::new(x as u32, y as u32, z as u32), voxel);
            }
        }
    }
    chunk
}

/// Create a fully solid chunk.
fn create_solid_chunk() -> Chunk {
    let mut chunk = Chunk::new(IVec3::ZERO);
    for x in 0..CHUNK_SIZE {
        for y in 0..CHUNK_SIZE {
            for z in 0..CHUNK_SIZE {
                chunk.set(UVec3::new(x as u32, y as u32, z as u32), VoxelType::Rock);
            }
        }
    }
    chunk
}

/// Create a terrain-like chunk with a surface.
fn create_terrain_chunk() -> Chunk {
    let mut chunk = Chunk::new(IVec3::ZERO);
    for x in 0..CHUNK_SIZE {
        for y in 0..CHUNK_SIZE {
            for z in 0..CHUNK_SIZE {
                // Create a simple heightmap-based terrain
                let height = 8 + ((x as f32 * 0.5).sin() * 2.0) as usize;
                let voxel = if y < height {
                    if y == 0 {
                        VoxelType::Bedrock
                    } else if y < height - 3 {
                        VoxelType::Rock
                    } else if y < height - 1 {
                        VoxelType::Dirt
                    } else {
                        VoxelType::Grass
                    }
                } else {
                    VoxelType::Air
                };
                chunk.set(UVec3::new(x as u32, y as u32, z as u32), voxel);
            }
        }
    }
    chunk
}

fn benchmark_chunk_creation(c: &mut Criterion) {
    let mut group = c.benchmark_group("chunk_creation");

    group.bench_function("empty_chunk", |b| {
        b.iter(|| {
            black_box(Chunk::new(IVec3::ZERO))
        })
    });

    group.bench_function("solid_chunk", |b| {
        b.iter(|| {
            black_box(create_solid_chunk())
        })
    });

    group.bench_function("terrain_chunk", |b| {
        b.iter(|| {
            black_box(create_terrain_chunk())
        })
    });

    group.bench_function("checkerboard_chunk", |b| {
        b.iter(|| {
            black_box(create_checkerboard_chunk())
        })
    });

    group.finish();
}

fn benchmark_voxel_access(c: &mut Criterion) {
    let chunk = create_terrain_chunk();

    let mut group = c.benchmark_group("voxel_access");

    group.bench_function("single_get", |b| {
        b.iter(|| {
            black_box(chunk.get(UVec3::new(8, 8, 8)))
        })
    });

    group.bench_function("iterate_all", |b| {
        b.iter(|| {
            let mut count = 0usize;
            for x in 0..CHUNK_SIZE {
                for y in 0..CHUNK_SIZE {
                    for z in 0..CHUNK_SIZE {
                        let v = chunk.get(UVec3::new(x as u32, y as u32, z as u32));
                        if v != VoxelType::Air {
                            count += 1;
                        }
                    }
                }
            }
            black_box(count)
        })
    });

    group.finish();
}

fn benchmark_voxel_set(c: &mut Criterion) {
    let mut group = c.benchmark_group("voxel_set");

    group.bench_function("single_set", |b| {
        let mut chunk = Chunk::new(IVec3::ZERO);
        b.iter(|| {
            chunk.set(UVec3::new(8, 8, 8), black_box(VoxelType::Rock));
        })
    });

    group.bench_function("fill_chunk", |b| {
        b.iter(|| {
            let mut chunk = Chunk::new(IVec3::ZERO);
            for x in 0..CHUNK_SIZE {
                for y in 0..CHUNK_SIZE {
                    for z in 0..CHUNK_SIZE {
                        chunk.set(UVec3::new(x as u32, y as u32, z as u32), VoxelType::Rock);
                    }
                }
            }
            black_box(chunk)
        })
    });

    group.finish();
}

fn benchmark_serialization(c: &mut Criterion) {
    let chunk = create_terrain_chunk();
    let data = chunk.to_data();

    let mut group = c.benchmark_group("serialization");

    group.bench_function("chunk_to_data", |b| {
        b.iter(|| {
            black_box(chunk.to_data())
        })
    });

    group.bench_function("chunk_from_data", |b| {
        b.iter(|| {
            black_box(Chunk::from_data(data.clone()))
        })
    });

    group.bench_function("bincode_serialize", |b| {
        b.iter(|| {
            black_box(bincode::serialize(&data).unwrap())
        })
    });

    let bytes = bincode::serialize(&data).unwrap();
    group.bench_function("bincode_deserialize", |b| {
        b.iter(|| {
            let result: voxel_builder::voxel::chunk::ChunkData =
                bincode::deserialize(black_box(&bytes)).unwrap();
            black_box(result)
        })
    });

    group.finish();
}

fn benchmark_mesh_data(c: &mut Criterion) {
    let mut group = c.benchmark_group("mesh_data");

    group.bench_function("create_empty", |b| {
        b.iter(|| {
            black_box(MeshData::new())
        })
    });

    group.bench_function("is_empty_check", |b| {
        let mesh = MeshData::new();
        b.iter(|| {
            black_box(mesh.is_empty())
        })
    });

    group.finish();
}

criterion_group!(
    benches,
    benchmark_chunk_creation,
    benchmark_voxel_access,
    benchmark_voxel_set,
    benchmark_serialization,
    benchmark_mesh_data,
);
criterion_main!(benches);
