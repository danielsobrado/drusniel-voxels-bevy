//! Benchmarks for world operations.

use bevy::math::IVec3;
use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};
use voxel_builder::constants::CHUNK_SIZE;
use voxel_builder::voxel::types::VoxelType;
use voxel_builder::voxel::world::VoxelWorld;

fn benchmark_world_creation(c: &mut Criterion) {
    let mut group = c.benchmark_group("world_creation");

    for size in [2, 4, 8].iter() {
        group.bench_with_input(
            BenchmarkId::new("world_new", format!("{}x{}x{}", size, size, size)),
            size,
            |b, &size| {
                b.iter(|| {
                    black_box(VoxelWorld::new(IVec3::new(size, size, size)))
                })
            },
        );
    }

    group.finish();
}

fn benchmark_coordinate_conversion(c: &mut Criterion) {
    let mut group = c.benchmark_group("coordinate_conversion");

    let test_positions = vec![
        IVec3::new(0, 0, 0),
        IVec3::new(15, 15, 15),
        IVec3::new(100, 50, 200),
        IVec3::new(-17, -17, -17),
    ];

    group.bench_function("world_to_chunk", |b| {
        b.iter(|| {
            for pos in &test_positions {
                black_box(VoxelWorld::world_to_chunk(*pos));
            }
        })
    });

    group.bench_function("world_to_local", |b| {
        b.iter(|| {
            for pos in &test_positions {
                black_box(VoxelWorld::world_to_local(*pos));
            }
        })
    });

    group.bench_function("both_conversions", |b| {
        b.iter(|| {
            for pos in &test_positions {
                let chunk = VoxelWorld::world_to_chunk(*pos);
                let local = VoxelWorld::world_to_local(*pos);
                black_box((chunk, local));
            }
        })
    });

    group.finish();
}

fn benchmark_voxel_operations(c: &mut Criterion) {
    let mut world = VoxelWorld::new(IVec3::new(4, 4, 4));

    let mut group = c.benchmark_group("world_voxel_ops");

    group.bench_function("get_voxel", |b| {
        b.iter(|| {
            black_box(world.get_voxel(IVec3::new(32, 32, 32)))
        })
    });

    group.bench_function("set_voxel", |b| {
        b.iter(|| {
            world.set_voxel(IVec3::new(32, 32, 32), VoxelType::Rock);
        })
    });

    group.bench_function("in_bounds_true", |b| {
        b.iter(|| {
            black_box(world.in_bounds(IVec3::new(32, 32, 32)))
        })
    });

    group.bench_function("in_bounds_false", |b| {
        b.iter(|| {
            black_box(world.in_bounds(IVec3::new(-1, -1, -1)))
        })
    });

    group.finish();
}

fn benchmark_chunk_access(c: &mut Criterion) {
    let mut world = VoxelWorld::new(IVec3::new(4, 4, 4));

    let mut group = c.benchmark_group("chunk_access");

    group.bench_function("get_chunk", |b| {
        b.iter(|| {
            black_box(world.get_chunk(IVec3::new(2, 2, 2)))
        })
    });

    group.bench_function("get_chunk_mut", |b| {
        b.iter(|| {
            // Use the pointer address to avoid returning a reference from the closure
            let ptr = world.get_chunk_mut(IVec3::new(2, 2, 2)).map(|chunk| chunk as *mut _);
            black_box(ptr)
        })
    });

    group.finish();
}

fn benchmark_bulk_operations(c: &mut Criterion) {
    let mut group = c.benchmark_group("bulk_operations");

    group.bench_function("set_1000_voxels", |b| {
        let mut world = VoxelWorld::new(IVec3::new(4, 4, 4));
        b.iter(|| {
            for i in 0..1000 {
                let x = (i % 64) as i32;
                let y = ((i / 64) % 64) as i32;
                let z = ((i / 4096) % 64) as i32;
                world.set_voxel(IVec3::new(x, y, z), VoxelType::Rock);
            }
        })
    });

    group.bench_function("get_1000_voxels", |b| {
        let world = VoxelWorld::new(IVec3::new(4, 4, 4));
        b.iter(|| {
            let mut count = 0;
            for i in 0..1000 {
                let x = (i % 64) as i32;
                let y = ((i / 64) % 64) as i32;
                let z = ((i / 4096) % 64) as i32;
                if world.get_voxel(IVec3::new(x, y, z)).is_some() {
                    count += 1;
                }
            }
            black_box(count)
        })
    });

    group.finish();
}

criterion_group!(
    benches,
    benchmark_world_creation,
    benchmark_coordinate_conversion,
    benchmark_voxel_operations,
    benchmark_chunk_access,
    benchmark_bulk_operations,
);
criterion_main!(benches);
