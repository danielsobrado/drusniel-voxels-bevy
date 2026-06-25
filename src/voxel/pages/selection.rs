//! Phase 5 Step 4 runtime CLOD page selection. This is a faithful port of
//! `tools/clod-poc/src/selection.ts`, adapted to Bevy ECS visibility.

use std::collections::{HashMap, HashSet};

use bevy::prelude::*;
use bevy::window::PrimaryWindow;

use super::build_queue::{ClodPageBuildStatus, ClodPageTree};
use super::material_tier::clod_page_material_quality_for_distance;
use super::ownership::ClodPageMeshGate;
use super::render::{ClodPageMeshBounds, ClodPageMeshTag};
use super::runtime::ClodPagesRuntime;
use super::types::PageFootprint;
use crate::gameplay::camera::controller::PlayerCamera;
use crate::gameplay::player::Player;
use crate::rendering::triplanar_material::{
    TerrainMaterialQuality, TriplanarMaterial, TriplanarMaterialHandle,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) struct ClodPageNodeKey {
    pub level: usize,
    pub coord: (i32, i32),
}

impl ClodPageNodeKey {
    pub(crate) fn new(level: usize, coord: (i32, i32)) -> Self {
        Self { level, coord }
    }
}

impl From<&ClodPageMeshTag> for ClodPageNodeKey {
    fn from(tag: &ClodPageMeshTag) -> Self {
        Self::new(tag.level, tag.coord)
    }
}

#[derive(Clone, Debug)]
pub(crate) struct ClodSelectionNode {
    pub key: ClodPageNodeKey,
    pub footprint: PageFootprint,
    pub center: Vec3,
    pub radius: f32,
    pub error_world: f32,
    pub children: Vec<ClodPageNodeKey>,
}

#[derive(Resource, Default)]
pub(crate) struct ClodPageSelectionIndex {
    pub revision: Option<u64>,
    roots: Vec<ClodPageNodeKey>,
    nodes: HashMap<ClodPageNodeKey, ClodSelectionNode>,
}

impl ClodPageSelectionIndex {
    pub(crate) fn clear(&mut self) {
        self.revision = None;
        self.roots.clear();
        self.nodes.clear();
    }

    pub(crate) fn rebuild(
        &mut self,
        tree: &ClodPageTree,
        bounds_by_node: &HashMap<ClodPageNodeKey, ClodPageMeshBounds>,
    ) {
        self.clear();

        let mut keys_by_level: Vec<HashSet<(i32, i32)>> =
            Vec::with_capacity(tree.nodes_by_level.len());
        for nodes in &tree.nodes_by_level {
            keys_by_level.push(nodes.iter().map(|node| node.coord).collect());
        }

        for nodes in &tree.nodes_by_level {
            for node in nodes {
                let key = ClodPageNodeKey::new(node.level, node.coord);
                let bounds = bounds_by_node.get(&key).copied().unwrap_or_default();
                self.nodes.insert(
                    key,
                    ClodSelectionNode {
                        key,
                        footprint: node.footprint,
                        center: bounding_sphere_center(node.footprint, bounds),
                        radius: bounding_sphere_radius(node.footprint, bounds),
                        error_world: node.error_world,
                        children: child_keys(key, &keys_by_level),
                    },
                );
            }
        }

        if let Some((level, nodes)) = tree
            .nodes_by_level
            .iter()
            .enumerate()
            .rfind(|(_, nodes)| !nodes.is_empty())
        {
            self.roots = nodes
                .iter()
                .map(|node| ClodPageNodeKey::new(level, node.coord))
                .collect();
        }
        self.revision = Some(tree.revision);
    }

    pub(crate) fn node(&self, key: ClodPageNodeKey) -> Option<&ClodSelectionNode> {
        self.nodes.get(&key)
    }
}

#[derive(Resource, Default)]
pub(crate) struct ClodPageSelectionState {
    split: HashSet<ClodPageNodeKey>,
    fades: HashMap<ClodPageNodeKey, f32>,
}

impl ClodPageSelectionState {
    fn clear(&mut self) {
        self.split.clear();
        self.fades.clear();
    }
}

struct SelectionParams {
    threshold_px: f32,
    hysteresis_merge_factor: f32,
    neighbor_level_delta_max: usize,
    viewport_h: f32,
    fov_y: f32,
    cam_pos: Vec3,
    near_field: NearFieldBubble,
}

#[derive(Clone, Copy)]
pub(crate) struct NearFieldBubble {
    pub(crate) player_center: Option<Vec2>,
    pub(crate) camera_center: Vec2,
    pub(crate) radius: f32,
    pub(crate) boundary_padding: f32,
}

impl NearFieldBubble {
    fn centers(self) -> impl Iterator<Item = Vec2> {
        self.player_center
            .into_iter()
            .chain(std::iter::once(self.camera_center))
    }
}

fn child_keys(key: ClodPageNodeKey, keys_by_level: &[HashSet<(i32, i32)>]) -> Vec<ClodPageNodeKey> {
    if key.level == 0 {
        return Vec::new();
    }
    let child_level = key.level - 1;
    let Some(existing) = keys_by_level.get(child_level) else {
        return Vec::new();
    };

    let mut children = Vec::with_capacity(4);
    for x in [key.coord.0 * 2, key.coord.0 * 2 + 1] {
        for z in [key.coord.1 * 2, key.coord.1 * 2 + 1] {
            if existing.contains(&(x, z)) {
                children.push(ClodPageNodeKey::new(child_level, (x, z)));
            }
        }
    }
    children
}

fn bounding_sphere_center(footprint: PageFootprint, bounds: ClodPageMeshBounds) -> Vec3 {
    Vec3::new(
        (footprint.min_x + footprint.max_x) * 0.5,
        (bounds.min_y + bounds.max_y) * 0.5,
        (footprint.min_z + footprint.max_z) * 0.5,
    )
}

fn bounding_sphere_radius(footprint: PageFootprint, bounds: ClodPageMeshBounds) -> f32 {
    Vec3::new(
        (footprint.max_x - footprint.min_x) * 0.5,
        (bounds.max_y - bounds.min_y) * 0.5,
        (footprint.max_z - footprint.min_z) * 0.5,
    )
    .length()
}

/// Plan §2 / PoC `errorPx`: distance is camera-to-bounding-sphere surface.
fn error_px(node: &ClodSelectionNode, params: &SelectionParams) -> f32 {
    let dist = (params.cam_pos.distance(node.center) - node.radius).max(0.001);
    (node.error_world * params.viewport_h) / (2.0 * dist * (params.fov_y * 0.5).tan())
}

pub(crate) fn rect_distance2_to_point(footprint: PageFootprint, point: Vec2) -> f32 {
    let dx = if point.x < footprint.min_x {
        footprint.min_x - point.x
    } else if point.x > footprint.max_x {
        point.x - footprint.max_x
    } else {
        0.0
    };
    let dz = if point.y < footprint.min_z {
        footprint.min_z - point.y
    } else if point.y > footprint.max_z {
        point.y - footprint.max_z
    } else {
        0.0
    };
    dx * dx + dz * dz
}

pub(crate) fn near_field_intersects_footprint(
    footprint: PageFootprint,
    bubble: NearFieldBubble,
) -> bool {
    let r = bubble.radius + bubble.boundary_padding;
    let r2 = r * r;
    bubble
        .centers()
        .any(|center| rect_distance2_to_point(footprint, center) <= r2)
}

fn near_field_forces_split(node: &ClodSelectionNode, bubble: NearFieldBubble) -> bool {
    near_field_intersects_footprint(node.footprint, bubble)
}

fn adjacent(a: &ClodSelectionNode, b: &ClodSelectionNode) -> bool {
    let fa = a.footprint;
    let fb = b.footprint;
    let overlap_z = fa.min_z < fb.max_z && fb.min_z < fa.max_z;
    let overlap_x = fa.min_x < fb.max_x && fb.min_x < fa.max_x;
    let touch_x = (fa.max_x == fb.min_x || fb.max_x == fa.min_x) && overlap_z;
    let touch_z = (fa.max_z == fb.min_z || fb.max_z == fa.min_z) && overlap_x;
    touch_x || touch_z
}

fn select_cut(
    index: &ClodPageSelectionIndex,
    params: &SelectionParams,
    prev_split: &HashSet<ClodPageNodeKey>,
) -> (Vec<ClodPageNodeKey>, HashSet<ClodPageNodeKey>) {
    let mut new_split = HashSet::new();
    let mut rendered = Vec::new();

    for root in &index.roots {
        visit_node(
            *root,
            index,
            params,
            prev_split,
            &mut new_split,
            &mut rendered,
        );
    }

    let rendered = enforce21(
        index,
        rendered,
        &mut new_split,
        params.neighbor_level_delta_max,
    );
    (rendered, new_split)
}

fn visit_node(
    key: ClodPageNodeKey,
    index: &ClodPageSelectionIndex,
    params: &SelectionParams,
    prev_split: &HashSet<ClodPageNodeKey>,
    new_split: &mut HashSet<ClodPageNodeKey>,
    rendered: &mut Vec<ClodPageNodeKey>,
) {
    let Some(node) = index.node(key) else {
        return;
    };
    if node.children.is_empty() {
        rendered.push(key);
        return;
    }

    let epx = error_px(node, params);
    let was_split = prev_split.contains(&key);
    let forced_by_near_field = near_field_forces_split(node, params.near_field);
    let should_split = if was_split {
        epx > params.threshold_px / params.hysteresis_merge_factor
    } else {
        epx > params.threshold_px
    };

    if forced_by_near_field || should_split {
        new_split.insert(key);
        for child in &node.children {
            visit_node(*child, index, params, prev_split, new_split, rendered);
        }
    } else {
        rendered.push(key);
    }
}

fn enforce21(
    index: &ClodPageSelectionIndex,
    rendered: Vec<ClodPageNodeKey>,
    split: &mut HashSet<ClodPageNodeKey>,
    max_delta: usize,
) -> Vec<ClodPageNodeKey> {
    let mut work = rendered;
    for _ in 0..64 {
        let mut did_split = false;
        'outer: for i in 0..work.len() {
            for j in (i + 1)..work.len() {
                let Some(a) = index.node(work[i]) else {
                    continue;
                };
                let Some(b) = index.node(work[j]) else {
                    continue;
                };
                if a.key.level.abs_diff(b.key.level) <= max_delta || !adjacent(a, b) {
                    continue;
                }

                let coarser = if a.key.level > b.key.level { a } else { b };
                if coarser.children.is_empty() {
                    continue;
                }
                split.insert(coarser.key);
                let coarser_key = coarser.key;
                let children = coarser.children.clone();
                work = work
                    .into_iter()
                    .filter(|key| *key != coarser_key)
                    .chain(children)
                    .collect();
                did_split = true;
                break 'outer;
            }
        }
        if !did_split {
            break;
        }
    }
    work
}

fn projection_fov_y(projection: &Projection) -> Option<f32> {
    match projection {
        Projection::Perspective(perspective) => Some(perspective.fov),
        Projection::Orthographic(orthographic) => {
            let height = orthographic.area.max.y - orthographic.area.min.y;
            (height > f32::EPSILON).then(|| 2.0 * (0.5 * height).atan())
        }
        Projection::Custom(_) => None,
    }
}

pub(crate) fn clod_near_field_bubble(
    runtime: &ClodPagesRuntime,
    camera_transform: &Transform,
    player_transform: Option<&Transform>,
) -> NearFieldBubble {
    let chunk_size = runtime.cfg.page.chunk_size as f32;
    NearFieldBubble {
        player_center: player_transform
            .map(|transform| Vec2::new(transform.translation.x, transform.translation.z)),
        camera_center: Vec2::new(
            camera_transform.translation.x,
            camera_transform.translation.z,
        ),
        radius: runtime.cfg.near_field.radius_chunks.max(0) as f32 * chunk_size,
        boundary_padding: (runtime.cfg.page.chunks_per_page * runtime.cfg.page.chunk_size) as f32,
    }
}

fn make_params(
    runtime: &ClodPagesRuntime,
    camera_transform: &Transform,
    projection: &Projection,
    viewport_h: f32,
    player_transform: Option<&Transform>,
) -> Option<SelectionParams> {
    let fov_y = projection_fov_y(projection)?;
    if viewport_h <= 0.0 || fov_y <= 0.0 {
        return None;
    }

    Some(SelectionParams {
        threshold_px: runtime.cfg.selection.error_threshold_px,
        hysteresis_merge_factor: runtime.cfg.selection.hysteresis_merge_factor,
        neighbor_level_delta_max: runtime.cfg.selection.neighbor_level_delta_max.max(0) as usize,
        viewport_h,
        fov_y,
        cam_pos: camera_transform.translation,
        near_field: clod_near_field_bubble(runtime, camera_transform, player_transform),
    })
}

fn set_page_fade(
    materials: &mut Assets<TriplanarMaterial>,
    handle: &Handle<TriplanarMaterial>,
    base_handle: &Handle<TriplanarMaterial>,
    fade: f32,
) {
    let fade = fade.clamp(0.0, 1.0);
    let dither = fade > 0.0 && fade < 0.999;
    let base_material = materials.get(base_handle).cloned();
    if materials.get(handle).is_some_and(|material| {
        (material.uniforms.clod_fade - fade).abs() <= 0.0001
            && material.clod_page_dither == dither
            && !page_material_needs_base_refresh(material, base_material.as_ref())
    }) {
        return;
    }
    if let Some(material) = materials.get_mut(handle) {
        if let Some(base_material) = base_material.as_ref() {
            if page_material_needs_base_refresh(material, Some(base_material)) {
                *material = base_material.clone();
                material.quality = base_material.quality;
            }
        }
        material.uniforms.clod_fade = fade;
        material.clod_page_dither = dither;
    }
}

fn page_material_needs_base_refresh(
    material: &TriplanarMaterial,
    base_material: Option<&TriplanarMaterial>,
) -> bool {
    let Some(base_material) = base_material else {
        return false;
    };
    material.grass_albedo.is_none() && base_material.grass_albedo.is_some()
        || material.grass_normal.is_none() && base_material.grass_normal.is_some()
        || material.rock_albedo.is_none() && base_material.rock_albedo.is_some()
        || material.rock_normal.is_none() && base_material.rock_normal.is_some()
        || material.sand_albedo.is_none() && base_material.sand_albedo.is_some()
        || material.sand_normal.is_none() && base_material.sand_normal.is_some()
        || material.dirt_albedo.is_none() && base_material.dirt_albedo.is_some()
        || material.dirt_normal.is_none() && base_material.dirt_normal.is_some()
}

fn hide_all_pages(
    query: &mut Query<(
        &ClodPageMeshTag,
        &mut Visibility,
        &MeshMaterial3d<TriplanarMaterial>,
    )>,
    materials: &mut Assets<TriplanarMaterial>,
    base_handle: &Handle<TriplanarMaterial>,
) {
    for (_, mut visibility, material) in query.iter_mut() {
        if *visibility != Visibility::Hidden {
            *visibility = Visibility::Hidden;
        }
        set_page_fade(materials, &material.0, base_handle, 0.0);
    }
}

fn should_hold_current_page_visibility(gate: Option<&ClodPageMeshGate>) -> bool {
    gate.is_some_and(ClodPageMeshGate::should_hold_pages_visible)
}

pub(crate) fn clod_page_selection_system(
    runtime: Res<ClodPagesRuntime>,
    tree: Res<ClodPageTree>,
    index: Res<ClodPageSelectionIndex>,
    gate: Option<Res<ClodPageMeshGate>>,
    mut state: ResMut<ClodPageSelectionState>,
    camera_query: Query<(&Transform, &Projection), With<PlayerCamera>>,
    player_query: Query<&Transform, (With<Player>, Without<PlayerCamera>)>,
    window_query: Query<&Window, With<PrimaryWindow>>,
    mut pages: Query<(
        &ClodPageMeshTag,
        &mut Visibility,
        &MeshMaterial3d<TriplanarMaterial>,
    )>,
    triplanar_material: Res<TriplanarMaterialHandle>,
    mut materials: ResMut<Assets<TriplanarMaterial>>,
) {
    let base_material_handle =
        triplanar_material.handle_for_quality(TerrainMaterialQuality::FullTriplanar);
    if index.revision.is_none() || !matches!(tree.status.as_ref(), Some(ClodPageBuildStatus::Ready))
    {
        state.clear();
        if !should_hold_current_page_visibility(gate.as_deref()) {
            hide_all_pages(&mut pages, &mut materials, &base_material_handle);
        }
        return;
    }

    let Ok((camera_transform, projection)) = camera_query.single() else {
        if !should_hold_current_page_visibility(gate.as_deref()) {
            state.clear();
            hide_all_pages(&mut pages, &mut materials, &base_material_handle);
        }
        return;
    };
    let Ok(window) = window_query.single() else {
        if !should_hold_current_page_visibility(gate.as_deref()) {
            state.clear();
            hide_all_pages(&mut pages, &mut materials, &base_material_handle);
        }
        return;
    };
    let player_transform = player_query.single().ok();
    let Some(params) = make_params(
        &runtime,
        camera_transform,
        projection,
        window.physical_height() as f32,
        player_transform,
    ) else {
        if !should_hold_current_page_visibility(gate.as_deref()) {
            state.clear();
            hide_all_pages(&mut pages, &mut materials, &base_material_handle);
        }
        return;
    };

    let (rendered, new_split) = select_cut(&index, &params, &state.split);
    state.split = new_split;

    let rendered: HashSet<ClodPageNodeKey> = rendered.into_iter().collect();
    let chunks_per_page = runtime.cfg.page.chunks_per_page as i32;
    let crossfade_frames = runtime.cfg.selection.crossfade_frames;
    let fade_step = if crossfade_frames == 0 {
        1.0
    } else {
        1.0 / crossfade_frames as f32
    };
    for (tag, mut visibility, material) in pages.iter_mut() {
        let key = ClodPageNodeKey::from(tag);
        let pending_live_restore = gate
            .as_deref()
            .is_some_and(|gate| gate.node_has_pending_restore(key, chunks_per_page));
        let outside_near_field = index.node(key).is_some_and(|node| {
            !near_field_intersects_footprint(node.footprint, params.near_field)
        });
        let in_cut = rendered.contains(&key);
        let current =
            state
                .fades
                .get(&key)
                .copied()
                .unwrap_or(if *visibility == Visibility::Visible {
                    1.0
                } else {
                    0.0
                });
        let next = if pending_live_restore && in_cut {
            1.0
        } else if !outside_near_field {
            0.0
        } else if in_cut {
            (current + fade_step).min(1.0)
        } else {
            (current - fade_step).max(0.0)
        };

        if next > 0.0 {
            state.fades.insert(key, next);
        } else {
            state.fades.remove(&key);
        }

        let quality_base_handle = index
            .node(key)
            .map(|node| {
                let distance = params.cam_pos.distance(node.center);
                let quality =
                    clod_page_material_quality_for_distance(distance, &runtime.cfg.material);
                triplanar_material.handle_for_quality(quality)
            })
            .unwrap_or(base_material_handle.clone());

        set_page_fade(
            &mut materials,
            &material.0,
            &quality_base_handle,
            next,
        );
        let desired_visibility = if next > 0.0 {
            Visibility::Visible
        } else {
            Visibility::Hidden
        };
        if *visibility != desired_visibility {
            *visibility = desired_visibility;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn footprint(min_x: f32, min_z: f32, max_x: f32, max_z: f32) -> PageFootprint {
        PageFootprint {
            min_x,
            min_z,
            max_x,
            max_z,
        }
    }

    fn node(
        key: ClodPageNodeKey,
        footprint: PageFootprint,
        error_world: f32,
        children: Vec<ClodPageNodeKey>,
    ) -> ClodSelectionNode {
        ClodSelectionNode {
            key,
            footprint,
            center: bounding_sphere_center(footprint, ClodPageMeshBounds::default()),
            radius: bounding_sphere_radius(footprint, ClodPageMeshBounds::default()),
            error_world,
            children,
        }
    }

    fn params(cam_pos: Vec3) -> SelectionParams {
        SelectionParams {
            threshold_px: 1.0,
            hysteresis_merge_factor: 1.5,
            neighbor_level_delta_max: 1,
            viewport_h: 100.0,
            fov_y: std::f32::consts::FRAC_PI_2,
            cam_pos,
            near_field: NearFieldBubble {
                player_center: None,
                camera_center: Vec2::new(1000.0, 1000.0),
                radius: 0.0,
                boundary_padding: 0.0,
            },
        }
    }

    fn params_for_epx(node: &ClodSelectionNode, target_epx: f32) -> SelectionParams {
        let mut params = params(Vec3::ZERO);
        let dist = (node.error_world * params.viewport_h)
            / (2.0 * target_epx * (params.fov_y * 0.5).tan());
        params.cam_pos = node.center + Vec3::Z * (node.radius + dist);
        params
    }

    fn has_descendant(
        index: &ClodPageSelectionIndex,
        ancestor: ClodPageNodeKey,
        candidate: ClodPageNodeKey,
    ) -> bool {
        let Some(node) = index.node(ancestor) else {
            return false;
        };
        node.children
            .iter()
            .any(|child| *child == candidate || has_descendant(index, *child, candidate))
    }

    fn assert_cut_has_no_ancestor_descendant_pair(
        index: &ClodPageSelectionIndex,
        rendered: &[ClodPageNodeKey],
    ) {
        for (i, a) in rendered.iter().enumerate() {
            for b in rendered.iter().skip(i + 1) {
                assert!(!has_descendant(index, *a, *b));
                assert!(!has_descendant(index, *b, *a));
            }
        }
    }

    #[test]
    fn error_px_uses_bounding_sphere_surface_distance() {
        let node = node(
            ClodPageNodeKey::new(0, (0, 0)),
            footprint(0.0, 0.0, 2.0, 2.0),
            1.0,
            Vec::new(),
        );
        let epx = error_px(&node, &params(Vec3::new(1.0, 0.0, 11.0)));

        let expected_dist = 10.0 - 2.0f32.sqrt();
        let expected = 100.0 / (2.0 * expected_dist * (std::f32::consts::FRAC_PI_4).tan());
        assert!((epx - expected).abs() < 1e-5);
    }

    #[test]
    fn selected_cut_is_a_partition_without_ancestor_descendant_overlap() {
        let root = ClodPageNodeKey::new(2, (0, 0));
        let split_child = ClodPageNodeKey::new(1, (0, 0));
        let rendered_child = ClodPageNodeKey::new(1, (1, 0));
        let leaf = ClodPageNodeKey::new(0, (0, 0));
        let mut index = ClodPageSelectionIndex::default();
        index.roots = vec![root];
        index.nodes.insert(
            root,
            node(
                root,
                footprint(0.0, 0.0, 64.0, 64.0),
                10.0,
                vec![split_child, rendered_child],
            ),
        );
        index.nodes.insert(
            split_child,
            node(
                split_child,
                footprint(0.0, 0.0, 32.0, 64.0),
                10.0,
                vec![leaf],
            ),
        );
        index.nodes.insert(
            rendered_child,
            node(
                rendered_child,
                footprint(32.0, 0.0, 64.0, 64.0),
                0.0,
                Vec::new(),
            ),
        );
        index.nodes.insert(
            leaf,
            node(leaf, footprint(0.0, 0.0, 32.0, 64.0), 0.0, Vec::new()),
        );

        let (rendered, split) =
            select_cut(&index, &params(Vec3::new(32.0, 0.0, 32.0)), &HashSet::new());

        assert!(split.contains(&root));
        assert!(split.contains(&split_child));
        assert!(rendered.contains(&leaf));
        assert!(rendered.contains(&rendered_child));
        assert!(!rendered.contains(&root));
        assert!(!rendered.contains(&split_child));
        assert_cut_has_no_ancestor_descendant_pair(&index, &rendered);
    }

    #[test]
    fn hysteresis_keeps_previous_split_until_merge_band() {
        let root = ClodPageNodeKey::new(1, (0, 0));
        let child = ClodPageNodeKey::new(0, (0, 0));
        let mut index = ClodPageSelectionIndex::default();
        index.roots = vec![root];
        index.nodes.insert(
            root,
            node(root, footprint(0.0, 0.0, 10.0, 10.0), 10.0, vec![child]),
        );
        index.nodes.insert(
            child,
            node(child, footprint(0.0, 0.0, 10.0, 10.0), 0.0, Vec::new()),
        );

        let mut prev = HashSet::new();
        let far_params = params(Vec3::new(5.0, 0.0, 1000.0));
        let (rendered, split) = select_cut(&index, &far_params, &prev);
        assert_eq!(rendered, vec![root]);
        assert!(split.is_empty());

        let near_params = params(Vec3::new(5.0, 0.0, 6.0));
        let (rendered, split) = select_cut(&index, &near_params, &prev);
        assert_eq!(rendered, vec![child]);
        assert!(split.contains(&root));

        prev.insert(root);
        let band_params = params(Vec3::new(5.0, 0.0, 750.0));
        let (rendered, split) = select_cut(&index, &band_params, &prev);
        assert_eq!(rendered, vec![child]);
        assert!(split.contains(&root));
    }

    #[test]
    fn hysteresis_band_does_not_flicker_when_epx_oscillates_inside_band() {
        let root = ClodPageNodeKey::new(1, (0, 0));
        let child = ClodPageNodeKey::new(0, (0, 0));
        let mut index = ClodPageSelectionIndex::default();
        let root_node = node(root, footprint(0.0, 0.0, 10.0, 10.0), 10.0, vec![child]);
        index.roots = vec![root];
        index.nodes.insert(root, root_node.clone());
        index.nodes.insert(
            child,
            node(child, footprint(0.0, 0.0, 10.0, 10.0), 0.0, Vec::new()),
        );

        let mut merged_state = HashSet::new();
        for target_epx in [0.9, 0.7, 0.95] {
            let (rendered, split) = select_cut(
                &index,
                &params_for_epx(&root_node, target_epx),
                &merged_state,
            );
            assert_eq!(rendered, vec![root]);
            assert!(split.is_empty());
            merged_state = split;
        }

        let mut split_state = HashSet::from([root]);
        for target_epx in [0.9, 0.7, 0.95] {
            let (rendered, split) = select_cut(
                &index,
                &params_for_epx(&root_node, target_epx),
                &split_state,
            );
            assert_eq!(rendered, vec![child]);
            assert!(split.contains(&root));
            split_state = split;
        }
    }

    #[test]
    fn enforce21_splits_adjacent_coarser_node() {
        let coarse = ClodPageNodeKey::new(2, (0, 0));
        let fine = ClodPageNodeKey::new(0, (4, 0));
        let child = ClodPageNodeKey::new(1, (1, 0));
        let mut index = ClodPageSelectionIndex::default();
        index.nodes.insert(
            coarse,
            node(coarse, footprint(0.0, 0.0, 64.0, 64.0), 0.0, vec![child]),
        );
        index.nodes.insert(
            fine,
            node(fine, footprint(64.0, 0.0, 80.0, 16.0), 0.0, Vec::new()),
        );
        index.nodes.insert(
            child,
            node(child, footprint(32.0, 0.0, 64.0, 32.0), 0.0, Vec::new()),
        );

        let mut split = HashSet::new();
        let rendered = enforce21(&index, vec![coarse, fine], &mut split, 1);
        assert!(split.contains(&coarse));
        assert!(rendered.contains(&child));
        assert!(!rendered.contains(&coarse));
    }

    #[test]
    fn near_field_uses_union_centers_and_padding() {
        let page = node(
            ClodPageNodeKey::new(0, (0, 0)),
            footprint(0.0, 0.0, 64.0, 64.0),
            0.0,
            Vec::new(),
        );
        let bubble = NearFieldBubble {
            player_center: Some(Vec2::new(80.0, 32.0)),
            camera_center: Vec2::new(1000.0, 1000.0),
            radius: 10.0,
            boundary_padding: 6.0,
        };

        assert_eq!(
            rect_distance2_to_point(page.footprint, Vec2::new(32.0, 32.0)),
            0.0
        );
        assert_eq!(
            rect_distance2_to_point(page.footprint, Vec2::new(80.0, 32.0)),
            256.0
        );
        assert_eq!(
            rect_distance2_to_point(page.footprint, Vec2::new(80.0, 80.0)),
            512.0
        );
        assert!(near_field_forces_split(&page, bubble));

        let covering_bubble = NearFieldBubble {
            player_center: None,
            camera_center: Vec2::new(32.0, 32.0),
            radius: 46.0,
            boundary_padding: 0.0,
        };
        assert!(near_field_forces_split(&page, covering_bubble));
    }
}
