use bevy::diagnostic::{DiagnosticsStore, FrameCount};
use bevy::prelude::*;
use bevy::render::{
    Render, RenderApp, RenderSystems,
    render_phase::{BinnedPhaseItem, ViewBinnedRenderPhases, ViewSortedRenderPhases},
    view::{RenderVisibleEntities, window::prepare_windows},
};
use bevy::{
    core_pipeline::core_3d::{AlphaMask3d, Opaque3d, Transparent3d},
    mesh::Mesh3d,
    pbr::Shadow,
};
use std::collections::{BTreeMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use crate::performance::AreaTimingRecorder;
use crate::props::instanced_render::InstancedPropGroup;
use crate::rendering::building_material::BuildingMesh;
use crate::rendering::triplanar_material::TerrainMaterialQuality;
use crate::voxel::meshing::{ChunkMesh, MeshMode, WaterMesh, WaterMeshDetail};

#[derive(Clone)]
pub enum RenderTimingSample {
    Duration { area: String, duration_us: u64 },
    Counter { area: String, value: f64 },
}

#[derive(Resource, Clone, Default)]
pub struct RenderTimingSink {
    samples: Arc<Mutex<Vec<RenderTimingSample>>>,
}

impl RenderTimingSink {
    pub fn push_duration(&self, area: impl Into<String>, duration_us: u64) {
        if let Ok(mut samples) = self.samples.lock() {
            samples.push(RenderTimingSample::Duration {
                area: area.into(),
                duration_us,
            });
        }
    }

    pub fn push_count(&self, area: impl Into<String>, value: f64) {
        if let Ok(mut samples) = self.samples.lock() {
            samples.push(RenderTimingSample::Counter {
                area: area.into(),
                value,
            });
        }
    }

    pub fn drain(&self) -> Vec<RenderTimingSample> {
        self.samples
            .lock()
            .map(|mut samples| samples.drain(..).collect())
            .unwrap_or_default()
    }
}

pub struct RenderTimingGuard {
    sink: Option<RenderTimingSink>,
    area: &'static str,
    start: Option<Instant>,
}

impl Drop for RenderTimingGuard {
    fn drop(&mut self) {
        let (Some(sink), Some(start)) = (&self.sink, self.start) else {
            return;
        };
        sink.push_duration(self.area, start.elapsed().as_micros() as u64);
    }
}

pub fn render_timing_guard(
    sink: Option<&RenderTimingSink>,
    area: &'static str,
) -> RenderTimingGuard {
    RenderTimingGuard {
        sink: sink.cloned(),
        area,
        start: sink.map(|_| Instant::now()),
    }
}

#[derive(Resource, Default)]
struct RenderTimingMarkers {
    starts: BTreeMap<&'static str, Instant>,
}

impl RenderTimingMarkers {
    fn begin(&mut self, key: &'static str) {
        self.starts.insert(key, Instant::now());
    }

    fn end(&mut self, key: &'static str, sink: &RenderTimingSink, area: &'static str) {
        let Some(start) = self.starts.remove(key) else {
            return;
        };
        sink.push_duration(area, start.elapsed().as_micros() as u64);
    }
}

macro_rules! render_timing_pair {
    ($begin:ident, $end:ident, $key:literal, $area:literal) => {
        fn $begin(mut markers: ResMut<RenderTimingMarkers>) {
            markers.begin($key);
        }

        fn $end(mut markers: ResMut<RenderTimingMarkers>, sink: Res<RenderTimingSink>) {
            markers.end($key, &sink, $area);
        }
    };
}

render_timing_pair!(
    begin_prepare_assets,
    end_prepare_assets,
    "prepare_assets",
    "Render PrepareAssets CPU"
);
render_timing_pair!(
    begin_prepare_meshes,
    end_prepare_meshes,
    "prepare_meshes",
    "Render PrepareMeshes CPU"
);
render_timing_pair!(
    begin_present_acquire,
    end_present_acquire,
    "present_acquire",
    "Render Present Acquire CPU"
);
render_timing_pair!(
    begin_manage_views,
    end_manage_views,
    "manage_views",
    "Render ManageViews CPU"
);
render_timing_pair!(begin_queue, end_queue, "queue", "Render Queue CPU");
render_timing_pair!(
    begin_queue_meshes,
    end_queue_meshes,
    "queue_meshes",
    "Render QueueMeshes CPU"
);
render_timing_pair!(
    begin_phase_sort,
    end_phase_sort,
    "phase_sort",
    "Render PhaseSort CPU"
);
render_timing_pair!(begin_prepare, end_prepare, "prepare", "Render Prepare CPU");
render_timing_pair!(
    begin_prepare_resources,
    end_prepare_resources,
    "prepare_resources",
    "Render PrepareResources CPU"
);
render_timing_pair!(
    begin_prepare_bind_groups,
    end_prepare_bind_groups,
    "prepare_bind_groups",
    "Render PrepareBindGroups CPU"
);
render_timing_pair!(
    begin_render_graph,
    end_render_graph,
    "render_graph",
    "Render Graph CPU"
);

pub fn install_render_timing(app: &mut App) {
    let sink = RenderTimingSink::default();
    app.insert_resource(sink.clone())
        .add_plugins(bevy::render::diagnostic::RenderDiagnosticsPlugin)
        .add_systems(Update, drain_render_timing_samples);

    if let Some(render_app) = app.get_sub_app_mut(RenderApp) {
        render_app
            .insert_resource(sink)
            .init_resource::<RenderTimingMarkers>()
            .add_systems(
                Render,
                (
                    begin_prepare_assets.before(RenderSystems::PrepareAssets),
                    end_prepare_assets.after(RenderSystems::PrepareAssets),
                    begin_prepare_meshes.before(RenderSystems::PrepareMeshes),
                    end_prepare_meshes.after(RenderSystems::PrepareMeshes),
                    begin_manage_views.before(RenderSystems::ManageViews),
                    end_manage_views.after(RenderSystems::ManageViews),
                    begin_present_acquire.before(prepare_windows),
                    end_present_acquire.after(prepare_windows),
                    begin_queue.before(RenderSystems::Queue),
                    end_queue.after(RenderSystems::Queue),
                ),
            )
            .add_systems(
                Render,
                (
                    begin_queue_meshes.before(RenderSystems::QueueMeshes),
                    end_queue_meshes.after(RenderSystems::QueueMeshes),
                    begin_phase_sort.before(RenderSystems::PhaseSort),
                    end_phase_sort.after(RenderSystems::PhaseSort),
                    record_render_phase_inventory.after(RenderSystems::PhaseSort),
                    begin_prepare.before(RenderSystems::Prepare),
                    end_prepare.after(RenderSystems::Prepare),
                    begin_prepare_resources.before(RenderSystems::PrepareResources),
                    end_prepare_resources
                        .after(RenderSystems::PrepareResources)
                        .before(RenderSystems::PrepareResourcesCollectPhaseBuffers),
                    begin_prepare_bind_groups
                        .after(RenderSystems::PrepareResourcesFlush)
                        .before(RenderSystems::PrepareBindGroups),
                    end_prepare_bind_groups
                        .after(RenderSystems::PrepareBindGroups)
                        .before(RenderSystems::Render),
                ),
            )
            .add_systems(
                Render,
                (
                    begin_render_graph.before(RenderSystems::Render),
                    end_render_graph.after(RenderSystems::Render),
                ),
            );
    }
}

#[derive(Default)]
struct BinnedPhaseInventory {
    views: usize,
    total_entries: usize,
    known_entity_items: usize,
    hidden_binned_bins: usize,
    multidraw_bins: usize,
    batchable_bins: usize,
    unbatchable_bins: usize,
    non_mesh_bins: usize,
    max_view_entries: usize,
}

#[derive(Default)]
struct SortedPhaseInventory {
    views: usize,
    total_items: usize,
    max_view_items: usize,
}

#[derive(Default)]
struct PhaseSourceInventory {
    terrain: usize,
    water: usize,
    instanced_props: usize,
    buildings: usize,
    unknown: usize,
}

#[derive(Default)]
struct TerrainPressureInventory {
    terrain_entities: usize,
    terrain_vertices: u64,
    terrain_triangles: u64,
    water_triangles: u64,
    triplanar_meshes: usize,
    blocky_meshes: usize,
    full_triplanar_meshes: usize,
    cheap_triplanar_meshes: usize,
    single_projection_far_meshes: usize,
    atlas_only_debug_meshes: usize,
    wireframe_debug_meshes: usize,
}

fn binned_phase_inventory<BPI>(phases: &ViewBinnedRenderPhases<BPI>) -> BinnedPhaseInventory
where
    BPI: BinnedPhaseItem,
{
    let mut stats = BinnedPhaseInventory::default();
    stats.views = phases.len();
    for phase in phases.values() {
        let multidraw_bins = phase
            .multidrawable_meshes
            .values()
            .map(|bins| bins.len())
            .sum::<usize>();
        let batchable_bins = phase.batchable_meshes.len();
        let unbatchable_bins = phase.unbatchable_meshes.len();
        let non_mesh_bins = phase.non_mesh_items.len();
        let unbatchable_items = phase
            .unbatchable_meshes
            .values()
            .map(|entities| entities.entities.len())
            .sum::<usize>();
        let non_mesh_items = phase
            .non_mesh_items
            .values()
            .map(|entities| entities.entities.len())
            .sum::<usize>();
        let hidden_bins = multidraw_bins + batchable_bins;
        let known_items = unbatchable_items + non_mesh_items;
        let entries = hidden_bins + known_items;

        stats.multidraw_bins += multidraw_bins;
        stats.batchable_bins += batchable_bins;
        stats.unbatchable_bins += unbatchable_bins;
        stats.non_mesh_bins += non_mesh_bins;
        stats.hidden_binned_bins += hidden_bins;
        stats.known_entity_items += known_items;
        stats.total_entries += entries;
        stats.max_view_entries = stats.max_view_entries.max(entries);
    }
    stats
}

fn sorted_phase_inventory<SPI>(phases: &ViewSortedRenderPhases<SPI>) -> SortedPhaseInventory
where
    SPI: bevy::render::render_phase::SortedPhaseItem,
{
    let mut stats = SortedPhaseInventory::default();
    stats.views = phases.len();
    for phase in phases.values() {
        let items = phase.items.len();
        stats.total_items += items;
        stats.max_view_items = stats.max_view_items.max(items);
    }
    stats
}

fn add_binned_sources<BPI>(
    phases: &ViewBinnedRenderPhases<BPI>,
    sources: &mut PhaseSourceInventory,
    terrain: &Query<(), With<ChunkMesh>>,
    water: &Query<(), With<WaterMesh>>,
    instanced: &Query<(), With<InstancedPropGroup>>,
    buildings: &Query<(), With<BuildingMesh>>,
) where
    BPI: BinnedPhaseItem,
{
    for phase in phases.values() {
        for entities in phase.unbatchable_meshes.values() {
            for entity in entities.entities.values().copied() {
                classify_phase_entity(entity, sources, terrain, water, instanced, buildings);
            }
        }
        for entities in phase.non_mesh_items.values() {
            for entity in entities.entities.values().copied() {
                classify_phase_entity(entity, sources, terrain, water, instanced, buildings);
            }
        }
    }
}

fn add_sorted_sources<SPI>(
    phases: &ViewSortedRenderPhases<SPI>,
    sources: &mut PhaseSourceInventory,
    terrain: &Query<(), With<ChunkMesh>>,
    water: &Query<(), With<WaterMesh>>,
    instanced: &Query<(), With<InstancedPropGroup>>,
    buildings: &Query<(), With<BuildingMesh>>,
) where
    SPI: bevy::render::render_phase::SortedPhaseItem,
{
    for phase in phases.values() {
        for item in &phase.items {
            classify_phase_entity(item.entity(), sources, terrain, water, instanced, buildings);
        }
    }
}

fn classify_phase_entity(
    entity: Entity,
    sources: &mut PhaseSourceInventory,
    terrain: &Query<(), With<ChunkMesh>>,
    water: &Query<(), With<WaterMesh>>,
    instanced: &Query<(), With<InstancedPropGroup>>,
    buildings: &Query<(), With<BuildingMesh>>,
) {
    if instanced.get(entity).is_ok() {
        sources.instanced_props += 1;
    } else if water.get(entity).is_ok() {
        sources.water += 1;
    } else if terrain.get(entity).is_ok() {
        sources.terrain += 1;
    } else if buildings.get(entity).is_ok() {
        sources.buildings += 1;
    } else {
        sources.unknown += 1;
    }
}

fn visible_mesh_source_inventory(
    views: &Query<&RenderVisibleEntities>,
    terrain: &Query<(), With<ChunkMesh>>,
    water: &Query<(), With<WaterMesh>>,
    instanced: &Query<(), With<InstancedPropGroup>>,
    buildings: &Query<(), With<BuildingMesh>>,
) -> PhaseSourceInventory {
    let mut sources = PhaseSourceInventory::default();
    for visible_entities in views.iter() {
        for (entity, _) in visible_entities.iter::<Mesh3d>().copied() {
            classify_phase_entity(entity, &mut sources, terrain, water, instanced, buildings);
        }
    }
    sources
}

fn visible_terrain_pressure_inventory(
    views: &Query<&RenderVisibleEntities>,
    terrain: &Query<&ChunkMesh, Without<WaterMesh>>,
    water: &Query<&WaterMeshDetail, With<WaterMesh>>,
) -> TerrainPressureInventory {
    let mut stats = TerrainPressureInventory::default();
    let mut terrain_entities = HashSet::new();
    let mut water_entities = HashSet::new();

    for visible_entities in views.iter() {
        for (entity, _) in visible_entities.iter::<Mesh3d>().copied() {
            if terrain.get(entity).is_ok() {
                terrain_entities.insert(entity);
            } else if water.get(entity).is_ok() {
                water_entities.insert(entity);
            }
        }
    }

    for entity in terrain_entities {
        let Ok(chunk_mesh) = terrain.get(entity) else {
            continue;
        };
        stats.terrain_entities += 1;
        stats.terrain_vertices += chunk_mesh.vertex_count as u64;
        stats.terrain_triangles += chunk_mesh.triangle_count as u64;
        match chunk_mesh.mesh_mode {
            MeshMode::SurfaceNets | MeshMode::McTransvoxel => stats.triplanar_meshes += 1,
            MeshMode::Blocky => stats.blocky_meshes += 1,
        }
        match chunk_mesh.material_quality {
            TerrainMaterialQuality::FullTriplanar => stats.full_triplanar_meshes += 1,
            TerrainMaterialQuality::CheapTriplanar => stats.cheap_triplanar_meshes += 1,
            TerrainMaterialQuality::SingleProjectionFar => {
                stats.single_projection_far_meshes += 1;
            }
            TerrainMaterialQuality::HorizonProxy => {
                stats.single_projection_far_meshes += 1;
            }
            TerrainMaterialQuality::AtlasOnlyDebug => stats.atlas_only_debug_meshes += 1,
            TerrainMaterialQuality::WireframeDebug
            | TerrainMaterialQuality::NormalsDebug
            | TerrainMaterialQuality::WireframeNormalsDebug
            | TerrainMaterialQuality::FlatUnlitDebug
            | TerrainMaterialQuality::WireframeFlatUnlitDebug => stats.wireframe_debug_meshes += 1,
        }
    }

    for entity in water_entities {
        if let Ok(detail) = water.get(entity) {
            stats.water_triangles += detail.triangle_count as u64;
        }
    }

    stats
}

fn push_binned_phase_counts(
    sink: &RenderTimingSink,
    label: &'static str,
    counter_label: &'static str,
    stats: BinnedPhaseInventory,
) {
    sink.push_count(
        format!("Render Phase Items {counter_label} Total"),
        stats.total_entries as f64,
    );
    sink.push_count(
        format!("Render Phase Items {counter_label} Known Entity Items"),
        stats.known_entity_items as f64,
    );
    sink.push_count(
        format!("Render Phase Items {counter_label} Hidden Binned Bins"),
        stats.hidden_binned_bins as f64,
    );
    sink.push_count(
        format!("Render Phase Items {counter_label} Per View Max"),
        stats.max_view_entries as f64,
    );
    sink.push_count(
        format!("Render Phase Views {counter_label}"),
        stats.views as f64,
    );
    sink.push_count(
        format!("Render Phase Bins {label} Multidraw"),
        stats.multidraw_bins as f64,
    );
    sink.push_count(
        format!("Render Phase Bins {label} Batchable"),
        stats.batchable_bins as f64,
    );
    sink.push_count(
        format!("Render Phase Bins {label} Unbatchable"),
        stats.unbatchable_bins as f64,
    );
    sink.push_count(
        format!("Render Phase Bins {label} NonMesh"),
        stats.non_mesh_bins as f64,
    );
}

fn push_sorted_phase_counts(
    sink: &RenderTimingSink,
    counter_label: &'static str,
    stats: SortedPhaseInventory,
) {
    sink.push_count(
        format!("Render Phase Items {counter_label} Total"),
        stats.total_items as f64,
    );
    sink.push_count(
        format!("Render Phase Items {counter_label} Per View Max"),
        stats.max_view_items as f64,
    );
    sink.push_count(
        format!("Render Phase Views {counter_label}"),
        stats.views as f64,
    );
}

fn record_render_phase_inventory(
    sink: Option<Res<RenderTimingSink>>,
    opaque_phases: Option<Res<ViewBinnedRenderPhases<Opaque3d>>>,
    alpha_mask_phases: Option<Res<ViewBinnedRenderPhases<AlphaMask3d>>>,
    transparent_phases: Option<Res<ViewSortedRenderPhases<Transparent3d>>>,
    shadow_phases: Option<Res<ViewBinnedRenderPhases<Shadow>>>,
    opaque_prepass_phases: Option<
        Res<ViewBinnedRenderPhases<bevy::core_pipeline::prepass::Opaque3dPrepass>>,
    >,
    alpha_mask_prepass_phases: Option<
        Res<ViewBinnedRenderPhases<bevy::core_pipeline::prepass::AlphaMask3dPrepass>>,
    >,
    views: Query<&RenderVisibleEntities>,
    terrain: Query<(), With<ChunkMesh>>,
    water: Query<(), With<WaterMesh>>,
    terrain_meshes: Query<&ChunkMesh, Without<WaterMesh>>,
    water_details: Query<&WaterMeshDetail, With<WaterMesh>>,
    instanced: Query<(), With<InstancedPropGroup>>,
    buildings: Query<(), With<BuildingMesh>>,
) {
    let Some(sink) = sink else {
        return;
    };
    let mut exact_sources = PhaseSourceInventory::default();

    if let Some(phases) = opaque_phases.as_deref() {
        add_binned_sources(
            phases,
            &mut exact_sources,
            &terrain,
            &water,
            &instanced,
            &buildings,
        );
        push_binned_phase_counts(
            &sink,
            "Opaque3d",
            "Opaque3d",
            binned_phase_inventory(phases),
        );
    }
    if let Some(phases) = alpha_mask_phases.as_deref() {
        add_binned_sources(
            phases,
            &mut exact_sources,
            &terrain,
            &water,
            &instanced,
            &buildings,
        );
        push_binned_phase_counts(
            &sink,
            "AlphaMask3d",
            "AlphaMask3d",
            binned_phase_inventory(phases),
        );
    }
    if let Some(phases) = transparent_phases.as_deref() {
        add_sorted_sources(
            phases,
            &mut exact_sources,
            &terrain,
            &water,
            &instanced,
            &buildings,
        );
        push_sorted_phase_counts(&sink, "Transparent3d", sorted_phase_inventory(phases));
    }
    if let Some(phases) = shadow_phases.as_deref() {
        add_binned_sources(
            phases,
            &mut exact_sources,
            &terrain,
            &water,
            &instanced,
            &buildings,
        );
        push_binned_phase_counts(&sink, "Shadow", "Shadow", binned_phase_inventory(phases));
    }
    if let Some(phases) = opaque_prepass_phases.as_deref() {
        push_binned_phase_counts(
            &sink,
            "Opaque3dPrepass",
            "Opaque3dPrepass",
            binned_phase_inventory(phases),
        );
    }
    if let Some(phases) = alpha_mask_prepass_phases.as_deref() {
        push_binned_phase_counts(
            &sink,
            "AlphaMask3dPrepass",
            "AlphaMask3dPrepass",
            binned_phase_inventory(phases),
        );
    }

    let visible_sources =
        visible_mesh_source_inventory(&views, &terrain, &water, &instanced, &buildings);
    sink.push_count("Render Phase Items Terrain", visible_sources.terrain as f64);
    sink.push_count("Render Phase Items Water", visible_sources.water as f64);
    sink.push_count(
        "Render Phase Items Instanced Props",
        visible_sources.instanced_props as f64,
    );
    sink.push_count(
        "Render Phase Items Buildings",
        visible_sources.buildings as f64,
    );
    sink.push_count("Render Phase Items Unknown", visible_sources.unknown as f64);
    sink.push_count(
        "Render Phase Items Exact Terrain",
        exact_sources.terrain as f64,
    );
    sink.push_count("Render Phase Items Exact Water", exact_sources.water as f64);
    sink.push_count(
        "Render Phase Items Exact Instanced Props",
        exact_sources.instanced_props as f64,
    );
    sink.push_count(
        "Render Phase Items Exact Buildings",
        exact_sources.buildings as f64,
    );
    sink.push_count(
        "Render Phase Items Exact Unknown",
        exact_sources.unknown as f64,
    );

    let terrain_pressure =
        visible_terrain_pressure_inventory(&views, &terrain_meshes, &water_details);
    sink.push_count(
        "Visible Terrain Mesh Entities",
        terrain_pressure.terrain_entities as f64,
    );
    sink.push_count(
        "Visible Terrain Vertices",
        terrain_pressure.terrain_vertices as f64,
    );
    sink.push_count(
        "Visible Terrain Triangles",
        terrain_pressure.terrain_triangles as f64,
    );
    sink.push_count(
        "Visible Water Triangles",
        terrain_pressure.water_triangles as f64,
    );
    sink.push_count(
        "Triplanar Terrain Mesh Count",
        terrain_pressure.triplanar_meshes as f64,
    );
    sink.push_count(
        "Blocky Terrain Mesh Count",
        terrain_pressure.blocky_meshes as f64,
    );
    sink.push_count(
        "Terrain Material Quality FullTriplanar Meshes",
        terrain_pressure.full_triplanar_meshes as f64,
    );
    sink.push_count(
        "Terrain Material Quality CheapTriplanar Meshes",
        terrain_pressure.cheap_triplanar_meshes as f64,
    );
    sink.push_count(
        "Terrain Material Quality SingleProjectionFar Meshes",
        terrain_pressure.single_projection_far_meshes as f64,
    );
    sink.push_count(
        "Terrain Material Quality AtlasOnlyDebug Meshes",
        terrain_pressure.atlas_only_debug_meshes as f64,
    );
    sink.push_count(
        "Terrain Material Quality WireframeDebug Meshes",
        terrain_pressure.wireframe_debug_meshes as f64,
    );
}

fn drain_render_timing_samples(
    sink: Option<Res<RenderTimingSink>>,
    mut timing: Option<ResMut<AreaTimingRecorder>>,
    frame: Res<FrameCount>,
    diagnostics: Res<DiagnosticsStore>,
) {
    let Some(timing) = timing.as_deref_mut() else {
        return;
    };
    if !timing.enabled {
        return;
    }

    if let Some(sink) = sink {
        for sample in sink.drain() {
            match sample {
                RenderTimingSample::Duration { area, duration_us } => {
                    timing.record_area(frame.0, area, duration_us);
                }
                RenderTimingSample::Counter { area, value } => {
                    timing.record_count(frame.0, area, value);
                }
            }
        }
    }

    for diagnostic in diagnostics.iter() {
        let path = diagnostic.path().as_str();
        let Some(area) = render_diagnostic_area(path) else {
            continue;
        };
        let Some(value_ms) = diagnostic.value() else {
            continue;
        };
        if value_ms.is_finite() && value_ms >= 0.0 {
            timing.record_area(frame.0, area, (value_ms * 1000.0) as u64);
        }
    }
}

fn render_diagnostic_area(path: &str) -> Option<String> {
    let path = path.strip_prefix("render/")?;
    if let Some(span) = path.strip_suffix("/elapsed_gpu") {
        Some(format!("GPU {}", span.replace('/', " / ")))
    } else {
        path.strip_suffix("/elapsed_cpu")
            .map(|span| format!("RenderGraph CPU {}", span.replace('/', " / ")))
    }
}
