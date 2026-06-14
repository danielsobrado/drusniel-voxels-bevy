use super::*;

#[derive(Resource, Default, Debug)]
pub(crate) struct WorldStartupOverlayState {
    ready_seconds: f32,
}

#[derive(Resource, Debug)]
pub(crate) struct WorldStartupFlameTexture {
    handle: Handle<Image>,
    last_update_secs: f32,
}

#[derive(Resource, Default, Debug)]
pub(crate) struct WorldStartupLoadingFlames {
    pub active: bool,
}

#[derive(Resource, Default, Debug)]
pub(crate) struct WorldStartupSetupState {
    pub(crate) frames_waited: u8,
    pub(crate) started: bool,
}

#[derive(Component)]
pub(crate) struct WorldStartupOverlay;

#[derive(Component)]
pub(crate) struct WorldStartupBackgroundImage;

#[derive(Component)]
pub(crate) struct WorldStartupFlamesImage;

#[derive(Component)]
pub(crate) struct WorldStartupTitleText;

#[derive(Component)]
pub(crate) struct WorldStartupDetailText;

#[derive(Component)]
pub(crate) struct WorldStartupPercentText;

#[derive(Component)]
pub(crate) struct WorldStartupProgressFill;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WorldStartupStage {
    LoadingSavedWorld,
    GeneratingTerrain,
    PreparingMeshes,
    Ready,
}

pub(crate) struct WorldStartupSnapshot {
    pub(crate) stage: WorldStartupStage,
    pub(crate) progress: f32,
    pub(crate) detail: String,
    pub(crate) complete: bool,
}

impl WorldStartupStage {
    fn title(self) -> &'static str {
        match self {
            Self::LoadingSavedWorld => "Loading existing world",
            Self::GeneratingTerrain => "Generating world",
            Self::PreparingMeshes => "Preparing terrain",
            Self::Ready => "World ready",
        }
    }
}
/// Tag bumped with each MC+Transvoxel hole-fix series. Logged at startup so
/// the user can verify their binary contains the latest source changes
/// without guessing from visuals. Bump when landing a fix that should affect
/// the visible mesh.
const MC_SPIKE_BUILD_TAG: &str = "mc-spike-2026-05-24-sdf-sign-guard-and-lod-refine-coarser";
const WORLD_STARTUP_FLAME_TEXTURE_WIDTH: u32 = 256;
const WORLD_STARTUP_FLAME_TEXTURE_HEIGHT: u32 = 144;
const WORLD_STARTUP_FLAME_UPDATE_INTERVAL_SECS: f32 = 1.0 / 12.0;
const WORLD_STARTUP_SPARK_LAYERS: u32 = 8;
const WORLD_STARTUP_FLAMES_ENABLED: bool = false;

pub(crate) fn log_mc_spike_build_tag(mc_settings: Res<McTransvoxelSettings>) {
    #[cfg(feature = "mc_transvoxel")]
    let mode = format!("{:?}", mc_settings.mode);
    #[cfg(not(feature = "mc_transvoxel"))]
    let mode = "feature-disabled".to_string();

    info!(
        "MC+Transvoxel spike build tag: {}; enabled={} mode={} lod_delta_policy={:?}",
        MC_SPIKE_BUILD_TAG, mc_settings.enabled, mode, mc_settings.lod_delta_policy,
    );
}

fn create_world_startup_flame_image(images: &mut Assets<Image>) -> Handle<Image> {
    let mut image = Image::new_fill(
        Extent3d {
            width: WORLD_STARTUP_FLAME_TEXTURE_WIDTH,
            height: WORLD_STARTUP_FLAME_TEXTURE_HEIGHT,
            depth_or_array_layers: 1,
        },
        TextureDimension::D2,
        &build_world_startup_flame_pixels(
            WORLD_STARTUP_FLAME_TEXTURE_WIDTH,
            WORLD_STARTUP_FLAME_TEXTURE_HEIGHT,
            0.0,
        ),
        TextureFormat::Rgba8UnormSrgb,
        RenderAssetUsages::MAIN_WORLD | RenderAssetUsages::RENDER_WORLD,
    );

    image.sampler = ImageSampler::Descriptor(ImageSamplerDescriptor {
        address_mode_u: ImageAddressMode::ClampToEdge,
        address_mode_v: ImageAddressMode::ClampToEdge,
        address_mode_w: ImageAddressMode::ClampToEdge,
        mag_filter: ImageFilterMode::Linear,
        min_filter: ImageFilterMode::Linear,
        mipmap_filter: ImageFilterMode::Linear,
        ..default()
    });

    images.add(image)
}

fn build_world_startup_flame_pixels(width: u32, height: u32, time: f32) -> Vec<u8> {
    let mut pixels = vec![0; (width * height * 4) as usize];
    fill_world_startup_flame_pixels(&mut pixels, width, height, time);
    pixels
}

fn fill_world_startup_flame_pixels(pixels: &mut [u8], width: u32, height: u32, time: f32) {
    let width_f = width.max(1) as f32;
    let height_f = height.max(1) as f32;

    for y in 0..height {
        let v = y as f32 / height_f;
        let from_bottom = v.clamp(0.0, 1.0);
        let flame_band = smoothstep(0.58, 1.0, from_bottom);
        let base_line = smoothstep(0.965, 1.0, from_bottom);
        let smoke_band = smoothstep(0.08, 0.78, 1.0 - from_bottom);
        for x in 0..width {
            let u = x as f32 / width_f;
            let center_fuel = (1.0 - (2.0 * u - 1.0).abs()).clamp(0.0, 1.0).powf(0.72);
            let edge_falloff = smoothstep(0.0, 0.16, u) * smoothstep(0.0, 0.16, 1.0 - u);
            let sway = flame_hash_noise(u * 3.0 + time * 0.25, v * 2.0 + time * 0.55) - 0.5;
            let n1 = flame_hash_noise(u * 9.0 + sway * 1.6, v * 6.0 + time * 1.35);
            let n2 = flame_hash_noise(u * 23.0 + time * 0.28 + sway * 2.4, v * 15.0 + time * 2.65);
            let tongues = ((n1 * 0.58 + n2 * 0.42) * center_fuel * edge_falloff).powf(1.55);
            let intensity = (base_line * 0.92 + flame_band * tongues * 0.55).clamp(0.0, 1.0);
            let smoke_center = (1.0 - (2.0 * u - 1.0).abs()).clamp(0.0, 1.0).powf(1.8);
            let smoke = (smoke_band * smoke_center * n2 * 0.085).clamp(0.0, 1.0);
            let particle = startup_fire_particles(u, v, time);
            let smoke_column = startup_smoke_column(u, v, time);
            let alpha = ((intensity * 0.14 + smoke * 0.10 + particle * 0.82 + smoke_column * 0.26)
                * 255.0)
                .clamp(0.0, 118.0) as u8;
            let idx = ((y * width + x) * 4) as usize;

            pixels[idx] =
                ((intensity * 220.0) + particle * 255.0 + smoke * 20.0 + smoke_column * 58.0)
                    .clamp(0.0, 255.0) as u8;
            pixels[idx + 1] = ((intensity.powf(1.45) * 68.0)
                + particle * 105.0
                + smoke * 18.0
                + smoke_column * 42.0)
                .clamp(0.0, 255.0) as u8;
            pixels[idx + 2] = ((intensity.powf(2.8) * 10.0)
                + particle * 4.0
                + smoke * 10.0
                + smoke_column * 18.0)
                .clamp(0.0, 255.0) as u8;
            pixels[idx + 3] = alpha;
        }
    }
}

fn startup_smoke_column(u: f32, v: f32, time: f32) -> f32 {
    let center = (1.0 - ((u - 0.5).abs() / 0.36)).clamp(0.0, 1.0).powf(1.35);
    let height = smoothstep(0.12, 0.82, 1.0 - v) * smoothstep(0.18, 0.84, v);
    let movement = Vec2::new(0.7, -1.0);
    let uv = Vec2::new((u - 0.5) * 3.6, (1.0 - v) * 2.2);
    let drift_uv = uv * 5.0 + movement * time * 0.95;
    let drift = startup_layered_noise1_2(drift_uv, 1.7, 0.7, 6, time * 0.2);
    let holes = startup_layered_noise1_2(uv * 4.0 + movement * time * 0.5, 1.8, 0.5, 3, time * 0.2);
    (center * height * drift.powf(1.45) * holes.powf(0.8) * 0.72).clamp(0.0, 1.0)
}

fn startup_fire_particles(u: f32, v: f32, time: f32) -> f32 {
    let mut particles = 0.0;
    let mut alpha = 1.0;

    for layer in 0..WORLD_STARTUP_SPARK_LAYERS {
        let layer_f = layer as f32;
        let columns = 7.0 + layer_f * 0.75;
        let movement = Vec2::new(0.7, -1.0);
        let uv = Vec2::new(u * columns, (1.0 - v) * columns);
        let noise_offset =
            (startup_noise2_2(uv * 2.0 + Vec2::splat(layer_f * 0.41)) - Vec2::splat(0.5)) * 0.24;
        let moved_uv = uv + movement * time * (0.52 + layer_f * 0.018) + noise_offset;
        let cell = moved_uv.x.floor();
        let row = moved_uv.y.floor();
        let seed = startup_hash1_2(Vec2::new(cell + layer_f * 19.1, row + layer_f * 7.7));
        let progress = (time * (0.18 + seed * 0.2) + seed + layer_f * 0.073).fract();
        let spark_y = 1.03 - progress * (0.82 + seed * 0.16);
        let base_x = (cell + 0.18 + startup_hash1_2(Vec2::new(cell, row + 2.0)) * 0.64) / columns;
        let sway = (progress * 6.283185 + seed * 12.7).sin() * (0.012 + seed * 0.026);
        let spark_x = base_x + sway + progress * 0.08;
        let dx = (u - spark_x) / (0.0045 + seed * 0.0035);
        let dy = (v - spark_y) / (0.013 + seed * 0.014);
        let dist = (dx * dx + dy * dy).sqrt();
        let ember = (1.0 - smoothstep(0.0, 1.0, dist)).powf(2.0);
        let fade_in = smoothstep(0.0, 0.18, progress);
        let fade_out = smoothstep(1.0, 0.58, progress);
        let center_life = (1.0 - (2.0 * u - 1.0).abs()).clamp(0.0, 1.0).powf(0.45);

        particles += ember * fade_in * fade_out * center_life * alpha;
        alpha *= 0.82;
    }

    (particles * 1.65).clamp(0.0, 1.0)
}

fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn startup_layered_noise1_2(
    mut uv: Vec2,
    size_mod: f32,
    alpha_mod: f32,
    layers: u32,
    animation: f32,
) -> f32 {
    let mut noise = 0.0;
    let mut alpha = 1.0;
    let mut size = 1.0;
    let mut offset = Vec2::ZERO;

    for _ in 0..layers {
        offset += startup_hash2_2(Vec2::new(alpha, size)) * 10.0;
        noise +=
            startup_noise1_2(uv * size + Vec2::new(0.7, -1.0) * animation * 8.0 + offset) * alpha;
        alpha *= alpha_mod;
        size *= size_mod;
    }

    uv += offset * 0.0;
    noise * (1.0 - alpha_mod) / (1.0 - alpha_mod.powf(layers as f32))
}

fn startup_hash1_2(x: Vec2) -> f32 {
    (x.dot(Vec2::new(52.127, 61.2871)).sin() * 521.582)
        .fract()
        .abs()
}

fn startup_hash2_2(x: Vec2) -> Vec2 {
    Vec2::new(
        (x.dot(Vec2::new(20.52, 70.291)).sin() * 492.194)
            .fract()
            .abs(),
        (x.dot(Vec2::new(24.1994, 80.171)).sin() * 492.194)
            .fract()
            .abs(),
    )
}

fn startup_noise2_2(uv: Vec2) -> Vec2 {
    let f = Vec2::new(
        smoothstep(0.0, 1.0, uv.x.fract()),
        smoothstep(0.0, 1.0, uv.y.fract()),
    );
    let uv00 = uv.floor();
    let uv01 = uv00 + Vec2::Y;
    let uv10 = uv00 + Vec2::X;
    let uv11 = uv00 + Vec2::ONE;

    let v00 = startup_hash2_2(uv00);
    let v01 = startup_hash2_2(uv01);
    let v10 = startup_hash2_2(uv10);
    let v11 = startup_hash2_2(uv11);
    let v0 = v00.lerp(v01, f.y);
    let v1 = v10.lerp(v11, f.y);
    v0.lerp(v1, f.x)
}

fn startup_noise1_2(uv: Vec2) -> f32 {
    let f = uv.fract();
    let uv00 = uv.floor();
    let uv01 = uv00 + Vec2::Y;
    let uv10 = uv00 + Vec2::X;
    let uv11 = uv00 + Vec2::ONE;

    let v00 = startup_hash1_2(uv00);
    let v01 = startup_hash1_2(uv01);
    let v10 = startup_hash1_2(uv10);
    let v11 = startup_hash1_2(uv11);
    let v0 = v00 + (v01 - v00) * f.y;
    let v1 = v10 + (v11 - v10) * f.y;
    v0 + (v1 - v0) * f.x
}

fn flame_hash_noise(x: f32, y: f32) -> f32 {
    let coarse_x = x.floor();
    let coarse_y = y.floor();
    let frac_x = x - coarse_x;
    let frac_y = y - coarse_y;
    let smooth_x = frac_x * frac_x * (3.0 - 2.0 * frac_x);
    let smooth_y = frac_y * frac_y * (3.0 - 2.0 * frac_y);

    let a = flame_hash(coarse_x, coarse_y);
    let b = flame_hash(coarse_x + 1.0, coarse_y);
    let c = flame_hash(coarse_x, coarse_y + 1.0);
    let d = flame_hash(coarse_x + 1.0, coarse_y + 1.0);
    let x1 = a + (b - a) * smooth_x;
    let x2 = c + (d - c) * smooth_x;
    x1 + (x2 - x1) * smooth_y
}

fn flame_hash(x: f32, y: f32) -> f32 {
    ((x * 127.1 + y * 311.7).sin() * 43758.547).fract().abs()
}

pub(crate) fn spawn_world_startup_overlay(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    mut images: ResMut<Assets<Image>>,
    mut loading_flames: ResMut<WorldStartupLoadingFlames>,
) {
    let background_image = asset_server.load("images/DrunsielShyntara.png");
    let flame_image = WORLD_STARTUP_FLAMES_ENABLED.then(|| {
        let flame_image = create_world_startup_flame_image(&mut images);
        commands.insert_resource(WorldStartupFlameTexture {
            handle: flame_image.clone(),
            last_update_secs: -WORLD_STARTUP_FLAME_UPDATE_INTERVAL_SECS,
        });
        flame_image
    });
    loading_flames.active = true;

    commands
        .spawn((
            Node {
                position_type: PositionType::Absolute,
                left: Val::Px(0.0),
                right: Val::Px(0.0),
                top: Val::Px(0.0),
                bottom: Val::Px(0.0),
                flex_direction: FlexDirection::Column,
                justify_content: JustifyContent::Center,
                align_items: AlignItems::Center,
                row_gap: Val::Px(12.0),
                padding: UiRect::all(Val::Px(24.0)),
                overflow: Overflow::clip(),
                ..default()
            },
            BackgroundColor(Color::srgb(0.015, 0.018, 0.02)),
            WorldStartupOverlay,
        ))
        .with_children(|root| {
            root.spawn((
                Node {
                    position_type: PositionType::Absolute,
                    left: Val::Px(0.0),
                    right: Val::Px(0.0),
                    top: Val::Px(0.0),
                    bottom: Val::Px(0.0),
                    width: Val::Percent(100.0),
                    height: Val::Percent(100.0),
                    ..default()
                },
                ImageNode::new(background_image).with_mode(NodeImageMode::Stretch),
                ZIndex(-2),
                WorldStartupBackgroundImage,
            ));

            root.spawn((
                Node {
                    position_type: PositionType::Absolute,
                    left: Val::Px(0.0),
                    right: Val::Px(0.0),
                    top: Val::Px(0.0),
                    bottom: Val::Px(0.0),
                    ..default()
                },
                BackgroundColor(Color::srgba(0.02, 0.025, 0.03, 0.58)),
                ZIndex(-1),
            ));

            if let Some(flame_image) = flame_image {
                root.spawn((
                    ImageNode::new(flame_image).with_mode(NodeImageMode::Stretch),
                    Node {
                        position_type: PositionType::Absolute,
                        left: Val::Px(0.0),
                        right: Val::Px(0.0),
                        top: Val::Px(0.0),
                        bottom: Val::Px(0.0),
                        width: Val::Percent(100.0),
                        height: Val::Percent(100.0),
                        ..default()
                    },
                    ZIndex(0),
                    WorldStartupFlamesImage,
                ));
            }

            root.spawn((
                Node {
                    flex_direction: FlexDirection::Column,
                    justify_content: JustifyContent::Center,
                    align_items: AlignItems::Center,
                    row_gap: Val::Px(12.0),
                    ..default()
                },
                ZIndex(2),
            ))
            .with_children(|content| {
                content.spawn((
                    Text::new("Loading existing world"),
                    TextFont {
                        font_size: 28.0,
                        ..default()
                    },
                    TextColor(Color::srgba(0.95, 0.97, 0.96, 1.0)),
                    WorldStartupTitleText,
                ));

                content.spawn((
                    Text::new("Checking saved world"),
                    TextFont {
                        font_size: 16.0,
                        ..default()
                    },
                    TextColor(Color::srgba(0.82, 0.88, 0.86, 1.0)),
                    WorldStartupDetailText,
                ));

                content
                    .spawn((
                        Node {
                            width: Val::Px(420.0),
                            max_width: Val::Percent(82.0),
                            height: Val::Px(10.0),
                            ..default()
                        },
                        BackgroundColor(Color::srgba(0.08, 0.1, 0.09, 0.9)),
                    ))
                    .with_children(|bar| {
                        bar.spawn((
                            Node {
                                width: Val::Percent(8.0),
                                height: Val::Percent(100.0),
                                ..default()
                            },
                            BackgroundColor(Color::srgba(0.47, 0.76, 0.46, 1.0)),
                            WorldStartupProgressFill,
                        ));
                    });

                content.spawn((
                    Text::new("Loading..."),
                    TextFont {
                        font_size: 14.0,
                        ..default()
                    },
                    TextColor(Color::srgba(0.9, 0.94, 0.92, 1.0)),
                    WorldStartupPercentText,
                ));
            });
        });
}

pub(crate) fn update_world_startup_background_cover(
    windows: Query<&Window, With<PrimaryWindow>>,
    images: Res<Assets<Image>>,
    mut background_query: Query<(&mut Node, &ImageNode), With<WorldStartupBackgroundImage>>,
) {
    let Ok(window) = windows.single() else {
        return;
    };
    let window_size = Vec2::new(window.width(), window.height());

    for (mut node, image_node) in background_query.iter_mut() {
        let Some(image) = images.get(&image_node.image) else {
            continue;
        };
        let Some(draw_size) = world_startup_background_cover_size(
            window_size,
            image.size().as_vec2(),
            WORLD_STARTUP_BACKGROUND_ZOOM,
        ) else {
            continue;
        };

        node.width = Val::Px(draw_size.x);
        node.height = Val::Px(draw_size.y);
        node.left = Val::Px((window_size.x - draw_size.x) * 0.5);
        node.top = Val::Px((window_size.y - draw_size.y) * 0.5);
        node.right = Val::Auto;
        node.bottom = Val::Auto;
    }
}

pub(crate) fn world_startup_background_cover_size(
    window_size: Vec2,
    image_size: Vec2,
    zoom: f32,
) -> Option<Vec2> {
    if window_size.x <= 0.0 || window_size.y <= 0.0 || image_size.x <= 0.0 || image_size.y <= 0.0 {
        return None;
    }

    let cover_scale = (window_size.x / image_size.x).max(window_size.y / image_size.y);
    Some(image_size * cover_scale * zoom.max(1.0))
}

pub(crate) fn update_world_startup_overlay(
    mut commands: Commands,
    time: Res<Time>,
    gen_state: Res<ChunkGenerationState>,
    chunk_stats: Res<RuntimeChunkStats>,
    page_mesh_gate: Option<Res<crate::voxel::pages::ClodPageMeshGate>>,
    setup_state: Res<WorldStartupSetupState>,
    mut overlay_state: ResMut<WorldStartupOverlayState>,
    mut loading_flames: ResMut<WorldStartupLoadingFlames>,
    flame_texture: Option<ResMut<WorldStartupFlameTexture>>,
    mut images: ResMut<Assets<Image>>,
    root_query: Query<Entity, With<WorldStartupOverlay>>,
    mut text_queries: ParamSet<(
        Query<&mut Text, With<WorldStartupTitleText>>,
        Query<&mut Text, With<WorldStartupDetailText>>,
        Query<&mut Text, With<WorldStartupPercentText>>,
    )>,
    mut fill_query: Query<&mut Node, With<WorldStartupProgressFill>>,
) {
    let Ok(root_entity) = root_query.single() else {
        loading_flames.active = false;
        return;
    };
    loading_flames.active = true;

    if let Some(mut flame_texture) = flame_texture {
        let now = time.elapsed_secs();
        if now - flame_texture.last_update_secs >= WORLD_STARTUP_FLAME_UPDATE_INTERVAL_SECS {
            if let Some(image) = images.get_mut(&flame_texture.handle) {
                if let Some(data) = image.data.as_mut() {
                    fill_world_startup_flame_pixels(
                        data,
                        WORLD_STARTUP_FLAME_TEXTURE_WIDTH,
                        WORLD_STARTUP_FLAME_TEXTURE_HEIGHT,
                        now,
                    );
                }
            }
            flame_texture.last_update_secs = now;
        }
    }

    let snapshot = world_startup_snapshot(
        &gen_state,
        &chunk_stats,
        setup_state.started,
        page_mesh_gate.as_deref(),
    );
    if snapshot.complete {
        loading_flames.active = false;
        overlay_state.ready_seconds += time.delta_secs();
    } else {
        loading_flames.active = true;
        overlay_state.ready_seconds = 0.0;
    }

    if overlay_state.ready_seconds >= WORLD_STARTUP_READY_HOLD_SECONDS {
        loading_flames.active = false;
        commands.entity(root_entity).despawn();
        return;
    }

    if let Ok(mut text) = text_queries.p0().single_mut() {
        text.0 = snapshot.stage.title().to_string();
    }
    if let Ok(mut text) = text_queries.p1().single_mut() {
        text.0 = snapshot.detail;
    }
    if let Ok(mut text) = text_queries.p2().single_mut() {
        text.0 = if snapshot.stage == WorldStartupStage::LoadingSavedWorld {
            "Loading...".to_string()
        } else {
            format!("{:.0}%", snapshot.progress * 100.0)
        };
    }
    if let Ok(mut node) = fill_query.single_mut() {
        node.width = Val::Percent((snapshot.progress * 100.0).clamp(0.0, 100.0));
    }
}

pub(crate) fn world_startup_snapshot(
    gen_state: &ChunkGenerationState,
    chunk_stats: &RuntimeChunkStats,
    setup_started: bool,
    page_mesh_gate: Option<&crate::voxel::pages::ClodPageMeshGate>,
) -> WorldStartupSnapshot {
    if !setup_started {
        return WorldStartupSnapshot {
            stage: WorldStartupStage::LoadingSavedWorld,
            progress: 0.05,
            detail: "Starting world load".to_string(),
            complete: false,
        };
    }

    if !gen_state.is_complete && gen_state.loading_from_disk {
        return WorldStartupSnapshot {
            stage: WorldStartupStage::LoadingSavedWorld,
            progress: 0.12,
            detail: "Reading saved terrain data".to_string(),
            complete: false,
        };
    }

    if gen_state.is_generating() {
        let progress = gen_state.progress().clamp(0.0, 1.0);
        return WorldStartupSnapshot {
            stage: WorldStartupStage::GeneratingTerrain,
            progress: progress * 0.9,
            detail: format!(
                "Generated {} of {} chunks",
                gen_state.chunks_completed, gen_state.total_chunks
            ),
            complete: false,
        };
    }

    if chunk_stats.mesh_entities == 0 && chunk_stats.chunks_meshed_this_frame == 0 {
        let detail = if gen_state.loading_from_disk {
            "Saved world loaded; building visible terrain meshes"
        } else {
            "Terrain chunks complete; building visible meshes"
        };
        return WorldStartupSnapshot {
            stage: WorldStartupStage::PreparingMeshes,
            progress: 0.95,
            detail: detail.to_string(),
            complete: false,
        };
    }

    if chunk_stats.mesh_entities == 0
        && (chunk_stats.generation_dirty_chunks_queued > 0
            || chunk_stats.chunks_meshed_this_frame > 0
            || chunk_stats.chunks_skipped_this_frame > 0)
    {
        return WorldStartupSnapshot {
            stage: WorldStartupStage::PreparingMeshes,
            progress: 0.98,
            detail: format!(
                "Building terrain meshes ({} queued, {} waiting for neighbors)",
                chunk_stats
                    .generation_dirty_chunks_queued
                    .max(chunk_stats.dirty_chunks_queued),
                chunk_stats.surface_nets_chunks_deferred_for_halo
            ),
            complete: false,
        };
    }

    if chunk_stats.surface_nets_chunks_deferred_for_halo > 0 {
        return WorldStartupSnapshot {
            stage: WorldStartupStage::PreparingMeshes,
            progress: 0.98,
            detail: format!(
                "Building terrain meshes ({} queued, {} waiting for neighbors)",
                chunk_stats
                    .generation_dirty_chunks_queued
                    .max(chunk_stats.dirty_chunks_queued),
                chunk_stats.surface_nets_chunks_deferred_for_halo
            ),
            complete: false,
        };
    }

    if page_mesh_gate.is_some() {
        if page_mesh_gate.is_some_and(|gate| !gate.pages_ready && gate.pages_pending) {
            return WorldStartupSnapshot {
                stage: WorldStartupStage::PreparingMeshes,
                progress: 0.98,
                detail: "Building terrain pages".to_string(),
                complete: false,
            };
        }

        if chunk_stats.dirty_chunks_queued > 0 || chunk_stats.generation_dirty_chunks_queued > 0 {
            return WorldStartupSnapshot {
                stage: WorldStartupStage::PreparingMeshes,
                progress: 0.98,
                detail: format!(
                    "Building live terrain meshes ({} queued, {} page-owned skipped)",
                    chunk_stats
                        .generation_dirty_chunks_queued
                        .max(chunk_stats.dirty_chunks_queued),
                    chunk_stats.chunks_skipped_page_owned
                ),
                complete: false,
            };
        }
    }

    WorldStartupSnapshot {
        stage: WorldStartupStage::Ready,
        progress: 1.0,
        detail: format!(
            "Prepared {} terrain mesh chunks",
            chunk_stats
                .mesh_entities
                .max(chunk_stats.chunks_meshed_this_frame)
        ),
        complete: true,
    }
}
