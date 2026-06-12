use super::*;

#[derive(Clone, Debug)]
pub struct WaterBodyInfo {
    pub id: WaterBodyId,
    pub kind: WaterBodyKind,
    pub aabb_min: Vec3,
    pub aabb_max: Vec3,
    pub surface_y: f32,
    pub surface_area: f32,
    pub max_depth: usize,
    pub average_depth: f32,
    pub nearest_distance: f32,
    pub visible_chunks: u32,
    pub chunk_count: u32,
    pub material_mode: WaterBodyMaterialMode,
    pub reflection_strength: f32,
    pub fresnel_power: f32,
    pub distortion_strength: f32,
}

#[derive(Resource, Default, Debug)]
pub struct WaterBodyRegistry {
    pub bodies: HashMap<WaterBodyId, WaterBodyInfo>,
    pub total: u32,
    pub ocean: u32,
    pub lake: u32,
    pub river: u32,
    pub pond: u32,
    pub shallow_flood: u32,
    pub fancy_count: u32,
    pub cheap_count: u32,
    pub hidden_count: u32,
    pub material_switches: u32,
    pub chunks_forced_consistent: u32,
}

#[derive(Component)]
pub(crate) struct WaterMaskProxy;

impl WaterBodyRegistry {
    pub fn recount(&mut self) {
        self.reset_counts();
        let bodies = self.bodies.values().cloned().collect::<Vec<_>>();
        for body in &bodies {
            self.count_body(body);
        }
    }

    fn reset_counts(&mut self) {
        self.total = 0;
        self.ocean = 0;
        self.lake = 0;
        self.river = 0;
        self.pond = 0;
        self.shallow_flood = 0;
        self.fancy_count = 0;
        self.cheap_count = 0;
        self.hidden_count = 0;
        self.material_switches = 0;
        self.chunks_forced_consistent = 0;
    }

    fn count_body(&mut self, body: &WaterBodyInfo) {
        self.total += 1;
        match body.kind {
            WaterBodyKind::Ocean => self.ocean += 1,
            WaterBodyKind::Lake => self.lake += 1,
            WaterBodyKind::River => self.river += 1,
            WaterBodyKind::Pond => self.pond += 1,
            WaterBodyKind::ShallowFlood => self.shallow_flood += 1,
            WaterBodyKind::Unknown => {}
        }
        match body.material_mode {
            WaterBodyMaterialMode::Fancy => self.fancy_count += 1,
            WaterBodyMaterialMode::Cheap => self.cheap_count += 1,
            WaterBodyMaterialMode::Hidden => self.hidden_count += 1,
            WaterBodyMaterialMode::Unknown => {}
        }
    }
}
#[derive(Clone, Debug)]
pub(crate) struct WaterMeshBodySample {
    pub(crate) entity: Entity,
    pub(crate) chunk_pos: IVec3,
    pub(crate) surface_y: i32,
    pub(crate) surface_area: f32,
    pub(crate) max_depth: usize,
    pub(crate) average_depth: f32,
    pub(crate) aabb_min: Vec3,
    pub(crate) aabb_max: Vec3,
    pub(crate) touches_world_edge: bool,
    pub(crate) view_visible: bool,
    pub(crate) edge_north: WaterBodyEdgeMask,
    pub(crate) edge_south: WaterBodyEdgeMask,
    pub(crate) edge_west: WaterBodyEdgeMask,
    pub(crate) edge_east: WaterBodyEdgeMask,
}

type WaterBodyEdgeMask = u32;

#[derive(Clone, Debug)]
pub(crate) struct WaterBodyGroup {
    id: WaterBodyId,
    entities: Vec<Entity>,
    kind: WaterBodyKind,
    aabb_min: Vec3,
    aabb_max: Vec3,
    surface_y: i32,
    surface_area: f32,
    max_depth: usize,
    average_depth: f32,
    pub(crate) nearest_distance: f32,
    visible_chunks: u32,
    pub(crate) material_mode: WaterBodyMaterialMode,
}

pub(crate) fn update_water_body_registry(
    time: Res<Time>,
    world: Res<VoxelWorld>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
    water_meshes: Query<
        (
            Entity,
            &Transform,
            &ChunkMesh,
            Option<&WaterMeshDetail>,
            Option<&ViewVisibility>,
        ),
        With<WaterMesh>,
    >,
    mut commands: Commands,
    mut registry: ResMut<WaterBodyRegistry>,
    water_config: Option<Res<WaterConfig>>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
    mut last_update: Local<f32>,
) {
    let now = time.elapsed_secs();
    // Interval-only throttle. The old `!world.is_changed()` bypass re-ran the
    // full registry rebuild every frame whenever ANY system mutated VoxelWorld
    // (generation, edits, LOD churn) — exactly the busiest frames. A ≤0.5 s
    // stale registry is fine: it only drives water material/kind selection.
    if now - *last_update < WATER_BODY_UPDATE_INTERVAL {
        record_water_body_counters(frame.0, &mut timing, &registry);
        return;
    }
    *last_update = now;

    let camera_pos = camera_query
        .single()
        .ok()
        .map(|transform| transform.translation);
    let previous_modes: HashMap<WaterBodyId, WaterBodyMaterialMode> = registry
        .bodies
        .iter()
        .map(|(id, body)| (*id, body.material_mode))
        .collect();

    let mut samples = Vec::new();
    for (entity, transform, chunk_mesh, detail, view_visibility) in &water_meshes {
        let Some(sample) = sample_water_mesh_body(
            &world,
            entity,
            transform,
            chunk_mesh.chunk_position,
            detail,
            view_visibility,
        ) else {
            continue;
        };
        samples.push(sample);
    }

    let mut groups = build_water_body_groups(&samples, &world, camera_pos, &previous_modes);
    if let Some(forced_kind) = forced_water_body_kind("VOXEL_FORCE_WATER_BODY_KIND") {
        for group in &mut groups {
            group.kind = forced_kind;
        }
    } else if let Some(forced_kind) = forced_water_body_kind("VOXEL_FORCE_NEAREST_WATER_KIND") {
        if let Some(nearest_group) = groups
            .iter_mut()
            .min_by(|a, b| a.nearest_distance.total_cmp(&b.nearest_distance))
        {
            nearest_group.kind = forced_kind;
        }
    }
    let mut next_bodies = HashMap::new();
    registry.reset_counts();
    registry.material_switches = 0;

    for group in groups {
        let body_info = WaterBodyInfo {
            id: group.id,
            kind: group.kind,
            aabb_min: group.aabb_min,
            aabb_max: group.aabb_max,
            surface_y: group.surface_y as f32,
            surface_area: group.surface_area,
            max_depth: group.max_depth,
            average_depth: group.average_depth,
            nearest_distance: group.nearest_distance,
            visible_chunks: group.visible_chunks,
            chunk_count: group.entities.len() as u32,
            material_mode: group.material_mode,
            reflection_strength: water_body_reflection_strength(
                group.kind,
                group.max_depth,
                water_config.as_deref(),
            ),
            fresnel_power: water_body_fresnel_power(group.kind, water_config.as_deref()),
            distortion_strength: water_body_distortion_strength(
                group.kind,
                water_config.as_deref(),
            ),
        };
        if previous_modes
            .get(&group.id)
            .is_some_and(|previous| *previous != group.material_mode)
        {
            registry.material_switches += 1;
        }
        for entity in group.entities {
            commands.entity(entity).insert(group.id);
        }
        registry.count_body(&body_info);
        next_bodies.insert(group.id, body_info);
    }

    registry.bodies = next_bodies;
    record_water_body_counters(frame.0, &mut timing, &registry);
}

fn sample_water_mesh_body(
    world: &VoxelWorld,
    entity: Entity,
    transform: &Transform,
    chunk_pos: IVec3,
    detail: Option<&WaterMeshDetail>,
    view_visibility: Option<&ViewVisibility>,
) -> Option<WaterMeshBodySample> {
    let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
    let mut surface_cells: Vec<(i32, i32, i32, usize)> = Vec::new();
    let mut y_counts: HashMap<i32, usize> = HashMap::new();
    let mut max_depth = detail.map(|detail| detail.max_depth).unwrap_or(0);
    let mut total_depth = 0usize;

    for x in 0..CHUNK_SIZE_I32 {
        for z in 0..CHUNK_SIZE_I32 {
            for y in (0..CHUNK_SIZE_I32).rev() {
                let world_pos = chunk_origin + IVec3::new(x, y, z);
                let VoxelSample::InBounds(voxel) = world.sample_voxel_for_water_meshing(world_pos)
                else {
                    continue;
                };
                if !voxel.is_liquid() {
                    continue;
                }
                if matches!(
                    world.sample_voxel_for_water_meshing(world_pos + IVec3::Y),
                    VoxelSample::InBounds(above) if above.is_liquid()
                ) {
                    continue;
                }

                let mut depth = 1usize;
                loop {
                    let below_pos = world_pos - IVec3::Y * depth as i32;
                    match world.sample_voxel_for_water_meshing(below_pos) {
                        VoxelSample::InBounds(v) if v.is_liquid() => depth += 1,
                        _ => break,
                    }
                }
                max_depth = max_depth.max(depth);
                total_depth += depth;
                surface_cells.push((x, z, world_pos.y, depth));
                *y_counts.entry(world_pos.y).or_default() += 1;
                break;
            }
        }
    }

    if surface_cells.is_empty() {
        return detail.map(|detail| WaterMeshBodySample {
            entity,
            chunk_pos,
            surface_y: WATER_LEVEL,
            surface_area: detail
                .surface_area
                .max(detail.triangle_count as f32 * 0.5)
                .max(1.0),
            max_depth: detail.max_depth,
            average_depth: if detail.average_depth > 0.0 {
                detail.average_depth
            } else {
                detail.max_depth as f32
            },
            aabb_min: transform.translation,
            aabb_max: transform.translation + Vec3::splat(CHUNK_SIZE_F32),
            touches_world_edge: chunk_touches_world_edge(world, chunk_pos),
            view_visible: view_visibility.is_some_and(|visibility| visibility.get()),
            edge_north: 0,
            edge_south: 0,
            edge_west: 0,
            edge_east: 0,
        });
    }

    let surface_y = y_counts
        .into_iter()
        .max_by_key(|(_, count)| *count)
        .map(|(y, _)| y)
        .unwrap_or(WATER_LEVEL);

    let mut edge_north = 0;
    let mut edge_south = 0;
    let mut edge_west = 0;
    let mut edge_east = 0;
    for (x, z, y, _) in &surface_cells {
        if *y != surface_y {
            continue;
        }
        if *z == 0 {
            edge_north |= water_body_edge_bit(*x);
        }
        if *z == CHUNK_SIZE_I32 - 1 {
            edge_south |= water_body_edge_bit(*x);
        }
        if *x == 0 {
            edge_west |= water_body_edge_bit(*z);
        }
        if *x == CHUNK_SIZE_I32 - 1 {
            edge_east |= water_body_edge_bit(*z);
        }
    }

    let surface_area = surface_cells.len() as f32;
    Some(WaterMeshBodySample {
        entity,
        chunk_pos,
        surface_y,
        surface_area,
        max_depth,
        average_depth: if surface_cells.is_empty() {
            0.0
        } else {
            total_depth as f32 / surface_cells.len() as f32
        },
        aabb_min: transform.translation,
        aabb_max: transform.translation + Vec3::splat(CHUNK_SIZE_F32),
        touches_world_edge: chunk_touches_world_edge(world, chunk_pos),
        view_visible: view_visibility.is_some_and(|visibility| visibility.get()),
        edge_north,
        edge_south,
        edge_west,
        edge_east,
    })
}

pub(crate) fn water_body_edge_bit(edge_cell: i32) -> WaterBodyEdgeMask {
    if (0..CHUNK_SIZE_I32).contains(&edge_cell) {
        1u32 << edge_cell as u32
    } else {
        0
    }
}

pub(crate) fn build_water_body_groups(
    samples: &[WaterMeshBodySample],
    world: &VoxelWorld,
    camera_pos: Option<Vec3>,
    previous_modes: &HashMap<WaterBodyId, WaterBodyMaterialMode>,
) -> Vec<WaterBodyGroup> {
    let mut index_by_chunk = HashMap::new();
    for (index, sample) in samples.iter().enumerate() {
        index_by_chunk.insert(sample.chunk_pos, index);
    }

    let mut visited = vec![false; samples.len()];
    let mut groups = Vec::new();
    for start in 0..samples.len() {
        if visited[start] {
            continue;
        }
        visited[start] = true;
        let mut queue = VecDeque::from([start]);
        let mut indices = Vec::new();

        while let Some(index) = queue.pop_front() {
            indices.push(index);
            for neighbor in water_body_neighbors(index, samples, &index_by_chunk)
                .into_iter()
                .flatten()
            {
                if visited[neighbor] {
                    continue;
                }
                visited[neighbor] = true;
                queue.push_back(neighbor);
            }
        }

        groups.push(build_water_body_group(
            &indices,
            samples,
            world,
            camera_pos,
            previous_modes,
        ));
    }

    groups
}

fn water_body_neighbors(
    index: usize,
    samples: &[WaterMeshBodySample],
    index_by_chunk: &HashMap<IVec3, usize>,
) -> [Option<usize>; 4] {
    let sample = &samples[index];
    let candidates = [
        (
            sample.chunk_pos + IVec3::X,
            sample.edge_east,
            WaterBodyEdge::West,
        ),
        (
            sample.chunk_pos + IVec3::NEG_X,
            sample.edge_west,
            WaterBodyEdge::East,
        ),
        (
            sample.chunk_pos + IVec3::Z,
            sample.edge_south,
            WaterBodyEdge::North,
        ),
        (
            sample.chunk_pos + IVec3::NEG_Z,
            sample.edge_north,
            WaterBodyEdge::South,
        ),
    ];

    let mut neighbors = [None; 4];
    for (slot, (chunk_pos, edge, neighbor_edge)) in candidates.into_iter().enumerate() {
        let Some(&neighbor_index) = index_by_chunk.get(&chunk_pos) else {
            continue;
        };
        let neighbor = &samples[neighbor_index];
        if sample.surface_y != neighbor.surface_y {
            continue;
        }
        let other_edge = match neighbor_edge {
            WaterBodyEdge::North => neighbor.edge_north,
            WaterBodyEdge::South => neighbor.edge_south,
            WaterBodyEdge::West => neighbor.edge_west,
            WaterBodyEdge::East => neighbor.edge_east,
        };
        if edge & other_edge != 0 {
            neighbors[slot] = Some(neighbor_index);
        }
    }
    neighbors
}

enum WaterBodyEdge {
    North,
    South,
    West,
    East,
}

pub(crate) fn build_water_body_group(
    indices: &[usize],
    samples: &[WaterMeshBodySample],
    world: &VoxelWorld,
    camera_pos: Option<Vec3>,
    previous_modes: &HashMap<WaterBodyId, WaterBodyMaterialMode>,
) -> WaterBodyGroup {
    let mut entities = Vec::with_capacity(indices.len());
    let mut min_chunk = IVec3::splat(i32::MAX);
    let mut aabb_min = Vec3::splat(f32::INFINITY);
    let mut aabb_max = Vec3::splat(f32::NEG_INFINITY);
    let mut surface_area = 0.0;
    let mut max_depth = 0usize;
    let mut total_depth_weighted = 0.0;
    let mut touches_world_edge = false;
    let mut visible_chunks = 0u32;
    let mut surface_y = WATER_LEVEL;
    let mut nearest_distance = f32::INFINITY;

    for index in indices {
        let sample = &samples[*index];
        entities.push(sample.entity);
        min_chunk = min_chunk.min(sample.chunk_pos);
        aabb_min = aabb_min.min(sample.aabb_min);
        aabb_max = aabb_max.max(sample.aabb_max);
        surface_area += sample.surface_area;
        max_depth = max_depth.max(sample.max_depth);
        total_depth_weighted += sample.average_depth * sample.surface_area;
        touches_world_edge |= sample.touches_world_edge;
        visible_chunks += u32::from(sample.view_visible);
        surface_y = sample.surface_y;
        if let Some(pos) = camera_pos {
            nearest_distance =
                nearest_distance.min(distance_to_aabb_xz(pos, sample.aabb_min, sample.aabb_max));
        }
    }

    let id = stable_water_body_id(min_chunk, surface_y);
    let average_depth = if surface_area <= f32::EPSILON {
        0.0
    } else {
        total_depth_weighted / surface_area
    };
    let kind = classify_water_body(
        world,
        aabb_min,
        aabb_max,
        surface_area,
        max_depth,
        average_depth,
        touches_world_edge,
    );
    let previous = previous_modes
        .get(&id)
        .copied()
        .unwrap_or(WaterBodyMaterialMode::Unknown);
    let material_mode =
        water_body_material_mode(previous, nearest_distance, max_depth, surface_area, kind);

    WaterBodyGroup {
        id,
        entities,
        kind,
        aabb_min,
        aabb_max,
        surface_y,
        surface_area,
        max_depth,
        average_depth,
        nearest_distance,
        visible_chunks,
        material_mode,
    }
}

fn classify_water_body(
    world: &VoxelWorld,
    aabb_min: Vec3,
    aabb_max: Vec3,
    surface_area: f32,
    max_depth: usize,
    average_depth: f32,
    touches_world_edge: bool,
) -> WaterBodyKind {
    if touches_world_edge || surface_area >= WATER_BODY_OCEAN_MIN_AREA {
        return WaterBodyKind::Ocean;
    }

    let shallow_loaded_body = max_depth <= WATER_BODY_SHALLOW_FLOOD_MAX_DEPTH
        || average_depth <= WATER_BODY_SHALLOW_FLOOD_MAX_AVG_DEPTH;

    let extent = aabb_max - aabb_min;
    let long = extent.x.max(extent.z).max(1.0);
    let short = extent.x.min(extent.z).max(1.0);
    if !shallow_loaded_body
        && surface_area >= WATER_BODY_LAKE_MIN_AREA
        && long / short >= WATER_BODY_RIVER_ASPECT_RATIO
    {
        return WaterBodyKind::River;
    }

    let world_extent = world.world_size_chunks() * CHUNK_SIZE_I32;
    if aabb_min.x <= 0.0
        || aabb_min.z <= 0.0
        || aabb_max.x >= world_extent.x as f32
        || aabb_max.z >= world_extent.z as f32
    {
        WaterBodyKind::Ocean
    } else if shallow_loaded_body {
        WaterBodyKind::ShallowFlood
    } else if surface_area < WATER_BODY_POND_MAX_AREA {
        WaterBodyKind::Pond
    } else if max_depth >= WATER_BODY_LAKE_MIN_DEPTH
        && average_depth >= WATER_BODY_LAKE_MIN_AVG_DEPTH
        && surface_area >= WATER_BODY_LAKE_MIN_AREA
    {
        WaterBodyKind::Lake
    } else {
        WaterBodyKind::Pond
    }
}

fn forced_water_body_kind(name: &str) -> Option<WaterBodyKind> {
    let value = std::env::var(name).ok()?;
    match value.trim().to_ascii_lowercase().as_str() {
        "ocean" => Some(WaterBodyKind::Ocean),
        "lake" => Some(WaterBodyKind::Lake),
        "river" => Some(WaterBodyKind::River),
        "pond" => Some(WaterBodyKind::Pond),
        "shallow_flood" | "shallowflood" | "flood" => Some(WaterBodyKind::ShallowFlood),
        "unknown" => Some(WaterBodyKind::Unknown),
        _ => None,
    }
}

fn water_body_reflection_strength(
    kind: WaterBodyKind,
    max_depth: usize,
    water_config: Option<&WaterConfig>,
) -> f32 {
    if let Some(config) = water_config {
        return config.body_preset(kind).reflection_strength;
    }
    match kind {
        WaterBodyKind::Ocean => 0.85,
        WaterBodyKind::Lake => 0.76,
        WaterBodyKind::River => 0.58,
        WaterBodyKind::Pond => {
            if max_depth <= 2 {
                0.62
            } else {
                0.7
            }
        }
        WaterBodyKind::ShallowFlood => 0.08,
        WaterBodyKind::Unknown => 0.72,
    }
}

fn water_body_fresnel_power(kind: WaterBodyKind, water_config: Option<&WaterConfig>) -> f32 {
    if let Some(config) = water_config {
        return config.body_preset(kind).fresnel_power;
    }
    match kind {
        WaterBodyKind::Ocean => 5.0,
        WaterBodyKind::Lake => 4.5,
        WaterBodyKind::River => 4.0,
        WaterBodyKind::Pond => 4.0,
        WaterBodyKind::ShallowFlood => 3.0,
        WaterBodyKind::Unknown => 4.5,
    }
}

fn water_body_distortion_strength(kind: WaterBodyKind, water_config: Option<&WaterConfig>) -> f32 {
    if let Some(config) = water_config {
        return config.body_preset(kind).distortion_strength;
    }
    match kind {
        WaterBodyKind::Ocean => 0.006,
        WaterBodyKind::Lake => 0.0045,
        WaterBodyKind::River => 0.008,
        WaterBodyKind::Pond => 0.0035,
        WaterBodyKind::ShallowFlood => 0.001,
        WaterBodyKind::Unknown => 0.0045,
    }
}

pub(crate) fn water_body_material_mode(
    previous: WaterBodyMaterialMode,
    nearest_distance: f32,
    max_depth: usize,
    surface_area: f32,
    _kind: WaterBodyKind,
) -> WaterBodyMaterialMode {
    if env_flag("VOXEL_FORCE_ALL_WATER_CHEAP") {
        return WaterBodyMaterialMode::Cheap;
    }
    if env_flag("VOXEL_FORCE_ALL_WATER_FANCY") {
        return WaterBodyMaterialMode::Fancy;
    }
    if surface_area < WATER_FANCY_MIN_TRIANGLES as f32 || max_depth < WATER_FANCY_MIN_DEPTH {
        return WaterBodyMaterialMode::Cheap;
    }

    let fancy_in = (WATER_FANCY_DISTANCE - WATER_FANCY_HYSTERESIS).max(0.0);
    let fancy_out = WATER_FANCY_DISTANCE + WATER_FANCY_HYSTERESIS;
    match previous {
        WaterBodyMaterialMode::Fancy if nearest_distance <= fancy_out => {
            WaterBodyMaterialMode::Fancy
        }
        WaterBodyMaterialMode::Fancy => WaterBodyMaterialMode::Cheap,
        WaterBodyMaterialMode::Cheap if nearest_distance < fancy_in => WaterBodyMaterialMode::Fancy,
        WaterBodyMaterialMode::Cheap => WaterBodyMaterialMode::Cheap,
        _ if nearest_distance <= WATER_FANCY_DISTANCE => WaterBodyMaterialMode::Fancy,
        _ => WaterBodyMaterialMode::Cheap,
    }
}

fn stable_water_body_id(min_chunk: IVec3, surface_y: i32) -> WaterBodyId {
    let mut hash = 2_166_136_261u32;
    for value in [min_chunk.x, min_chunk.y, min_chunk.z, surface_y] {
        hash ^= value as u32;
        hash = hash.wrapping_mul(16_777_619);
    }
    WaterBodyId(hash.max(1))
}

fn chunk_touches_world_edge(world: &VoxelWorld, chunk_pos: IVec3) -> bool {
    let size = world.world_size_chunks();
    chunk_pos.x <= 0 || chunk_pos.z <= 0 || chunk_pos.x >= size.x - 1 || chunk_pos.z >= size.z - 1
}

fn distance_to_aabb_xz(position: Vec3, min: Vec3, max: Vec3) -> f32 {
    let dx = if position.x < min.x {
        min.x - position.x
    } else if position.x > max.x {
        position.x - max.x
    } else {
        0.0
    };
    let dz = if position.z < min.z {
        min.z - position.z
    } else if position.z > max.z {
        position.z - max.z
    } else {
        0.0
    };
    Vec2::new(dx, dz).length()
}

fn record_water_body_counters(
    frame: u32,
    timing: &mut AreaTimingRecorder,
    registry: &WaterBodyRegistry,
) {
    timing.record_count(frame, "Water Bodies Total", registry.total as f64);
    timing.record_count(frame, "Water Bodies Ocean", registry.ocean as f64);
    timing.record_count(frame, "Water Bodies Lake", registry.lake as f64);
    timing.record_count(frame, "Water Bodies River", registry.river as f64);
    timing.record_count(frame, "Water Bodies Pond", registry.pond as f64);
    timing.record_count(
        frame,
        "Water Bodies ShallowFlood",
        registry.shallow_flood as f64,
    );
    timing.record_count(frame, "Water Body Fancy Count", registry.fancy_count as f64);
    timing.record_count(frame, "Water Body Cheap Count", registry.cheap_count as f64);
    timing.record_count(
        frame,
        "Water Body Material Switches",
        registry.material_switches as f64,
    );
}

pub(crate) fn update_water_material_lod(
    time: Res<Time>,
    frame: Res<FrameCount>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
    water_material: Res<WaterMaterial>,
    mut registry: ResMut<WaterBodyRegistry>,
    mut timing: ResMut<AreaTimingRecorder>,
    mut commands: Commands,
    water_meshes: Query<
        (
            Entity,
            &Transform,
            Option<&MeshMaterial3d<StandardWaterMaterial>>,
            Option<&MeshMaterial3d<StandardMaterial>>,
            Option<&WaterMeshDetail>,
            Option<&WaterBodyId>,
            Option<&Visibility>,
        ),
        With<WaterMesh>,
    >,
    mut last_update: Local<f32>,
) {
    let now = time.elapsed_secs();
    if *last_update > 0.0 && now - *last_update < WATER_MATERIAL_UPDATE_INTERVAL {
        timing.record_count(
            frame.0,
            "Water Chunks Forced Consistent By Body",
            registry.chunks_forced_consistent as f64,
        );
        return;
    }
    *last_update = now;

    let Ok(camera_transform) = camera_query.single() else {
        timing.record_count(
            frame.0,
            "Water Chunks Forced Consistent By Body",
            registry.chunks_forced_consistent as f64,
        );
        return;
    };

    let camera_pos = camera_transform.translation;
    let force_fancy = env_flag("VOXEL_FORCE_ALL_WATER_FANCY");
    let force_cheap = env_flag("VOXEL_FORCE_ALL_WATER_CHEAP");
    let fancy_in = (WATER_FANCY_DISTANCE - WATER_FANCY_HYSTERESIS).max(0.0);
    let fancy_out = WATER_FANCY_DISTANCE + WATER_FANCY_HYSTERESIS;
    let fancy_in_sq = fancy_in * fancy_in;
    let fancy_out_sq = fancy_out * fancy_out;
    let fancy_distance_sq = WATER_FANCY_DISTANCE * WATER_FANCY_DISTANCE;
    registry.chunks_forced_consistent = 0;

    for (entity, transform, fancy_mat, cheap_mat, detail, body_id, visibility) in
        water_meshes.iter()
    {
        let fallback_kind = body_id
            .and_then(|id| registry.bodies.get(id).map(|body| body.kind))
            .unwrap_or(WaterBodyKind::Unknown);
        let body_mode_kind = body_id.and_then(|id| {
            registry
                .bodies
                .get(id)
                .map(|body| (body.material_mode, body.kind))
        });
        let desired_visibility = desired_water_visibility(
            force_cheap,
            force_fancy,
            body_mode_kind.map(|(mode, _)| mode),
        );
        if !water_visibility_matches(visibility, desired_visibility) {
            commands.entity(entity).insert(desired_visibility);
        }
        if force_cheap {
            let desired = water_material.far_handle_for_kind(fallback_kind);
            if !standard_material_matches(cheap_mat, &desired) {
                commands
                    .entity(entity)
                    .insert(MeshMaterial3d(desired))
                    .remove::<MeshMaterial3d<StandardWaterMaterial>>();
            }
            continue;
        }
        if force_fancy {
            let desired = water_material.near_handle_for_kind(fallback_kind);
            if !standard_water_material_matches(fancy_mat, &desired) {
                commands
                    .entity(entity)
                    .insert(MeshMaterial3d(desired))
                    .remove::<MeshMaterial3d<StandardMaterial>>();
            }
            continue;
        }
        if let Some((body_mode, body_kind)) = body_mode_kind {
            match body_mode {
                WaterBodyMaterialMode::Fancy => {
                    let desired = water_material.near_handle_for_kind(body_kind);
                    if !standard_water_material_matches(fancy_mat, &desired) {
                        registry.chunks_forced_consistent += 1;
                        commands
                            .entity(entity)
                            .insert(MeshMaterial3d(desired))
                            .remove::<MeshMaterial3d<StandardMaterial>>();
                    }
                }
                WaterBodyMaterialMode::Cheap | WaterBodyMaterialMode::Unknown => {
                    let desired = water_material.far_handle_for_kind(body_kind);
                    if !standard_material_matches(cheap_mat, &desired) {
                        registry.chunks_forced_consistent += 1;
                        commands
                            .entity(entity)
                            .insert(MeshMaterial3d(desired))
                            .remove::<MeshMaterial3d<StandardWaterMaterial>>();
                    }
                }
                WaterBodyMaterialMode::Hidden => {}
            }
            continue;
        }

        let allow_fancy_water = detail
            .map(|detail| {
                detail.triangle_count >= WATER_FANCY_MIN_TRIANGLES
                    && detail.max_depth >= WATER_FANCY_MIN_DEPTH
            })
            .unwrap_or(true);
        let chunk_center = transform.translation + Vec3::splat(CHUNK_SIZE_F32 * 0.5);
        let dist_sq = chunk_center.distance_squared(camera_pos);

        if !allow_fancy_water {
            let desired = water_material.far_handle_for_kind(WaterBodyKind::Unknown);
            if !standard_material_matches(cheap_mat, &desired) {
                commands
                    .entity(entity)
                    .insert(MeshMaterial3d(desired))
                    .remove::<MeshMaterial3d<StandardWaterMaterial>>();
            }
            continue;
        }

        if fancy_mat.is_some() {
            if dist_sq > fancy_out_sq {
                commands
                    .entity(entity)
                    .insert(MeshMaterial3d(
                        water_material.far_handle_for_kind(WaterBodyKind::Unknown),
                    ))
                    .remove::<MeshMaterial3d<StandardWaterMaterial>>();
            }
        } else if cheap_mat.is_some() {
            if dist_sq < fancy_in_sq {
                commands
                    .entity(entity)
                    .insert(MeshMaterial3d(
                        water_material.near_handle_for_kind(WaterBodyKind::Unknown),
                    ))
                    .remove::<MeshMaterial3d<StandardMaterial>>();
            }
        } else {
            if dist_sq <= fancy_distance_sq {
                commands.entity(entity).insert(MeshMaterial3d(
                    water_material.near_handle_for_kind(WaterBodyKind::Unknown),
                ));
            } else {
                commands.entity(entity).insert(MeshMaterial3d(
                    water_material.far_handle_for_kind(WaterBodyKind::Unknown),
                ));
            }
        }
    }
    timing.record_count(
        frame.0,
        "Water Chunks Forced Consistent By Body",
        registry.chunks_forced_consistent as f64,
    );
}

pub(crate) fn desired_water_visibility(
    force_cheap: bool,
    force_fancy: bool,
    body_mode: Option<WaterBodyMaterialMode>,
) -> Visibility {
    if force_cheap || force_fancy {
        return Visibility::Inherited;
    }
    match body_mode {
        Some(WaterBodyMaterialMode::Hidden) => Visibility::Hidden,
        _ => Visibility::Inherited,
    }
}

fn water_visibility_matches(current: Option<&Visibility>, desired: Visibility) -> bool {
    current.is_some_and(|current| *current == desired)
}

fn standard_water_material_matches(
    material: Option<&MeshMaterial3d<StandardWaterMaterial>>,
    desired: &Handle<StandardWaterMaterial>,
) -> bool {
    material.is_some_and(|material| material.0.id() == desired.id())
}

fn standard_material_matches(
    material: Option<&MeshMaterial3d<StandardMaterial>>,
    desired: &Handle<StandardMaterial>,
) -> bool {
    material.is_some_and(|material| material.0.id() == desired.id())
}

pub(crate) fn draw_water_body_debug_overlay(
    overlay_state: Option<Res<crate::interaction::DebugOverlayState>>,
    runtime_debug: Option<Res<crate::runtime_commands::RuntimeViewportDebugState>>,
    registry: Res<WaterBodyRegistry>,
    water_meshes: Query<(&Transform, Option<&WaterBodyId>), With<WaterMesh>>,
    mut gizmos: Gizmos,
) {
    if !overlay_state.is_some_and(|state| state.visible)
        && !runtime_debug.is_some_and(|debug| debug.editor_controlled && debug.water_debug)
    {
        return;
    }

    for (transform, body_id) in &water_meshes {
        let (mode, kind) = body_id
            .and_then(|id| registry.bodies.get(id))
            .map(|body| (body.material_mode, body.kind))
            .unwrap_or((WaterBodyMaterialMode::Unknown, WaterBodyKind::Unknown));
        let color = water_body_debug_color(mode, kind);
        let center = transform.translation
            + Vec3::new(
                CHUNK_SIZE_F32 * 0.5,
                CHUNK_SIZE_F32 * 0.5,
                CHUNK_SIZE_F32 * 0.5,
            );
        let cuboid = Cuboid::new(CHUNK_SIZE_F32, CHUNK_SIZE_F32, CHUNK_SIZE_F32);
        gizmos.primitive_3d(&cuboid, Isometry3d::from_translation(center), color);
    }
}

fn water_body_debug_color(mode: WaterBodyMaterialMode, kind: WaterBodyKind) -> Color {
    match mode {
        WaterBodyMaterialMode::Fancy => Color::srgba(0.0, 0.85, 1.0, 0.65),
        WaterBodyMaterialMode::Cheap => Color::srgba(1.0, 0.75, 0.05, 0.65),
        WaterBodyMaterialMode::Hidden => Color::srgba(1.0, 0.1, 0.1, 0.75),
        WaterBodyMaterialMode::Unknown => match kind {
            WaterBodyKind::Ocean => Color::srgba(0.2, 0.4, 1.0, 0.55),
            WaterBodyKind::Lake => Color::srgba(0.1, 0.9, 0.4, 0.55),
            WaterBodyKind::River => Color::srgba(0.7, 0.3, 1.0, 0.55),
            WaterBodyKind::Pond => Color::srgba(0.9, 0.9, 0.2, 0.55),
            WaterBodyKind::ShallowFlood => Color::srgba(1.0, 0.1, 0.05, 0.55),
            WaterBodyKind::Unknown => Color::srgba(1.0, 1.0, 1.0, 0.45),
        },
    }
}
