/// Water Displacement System — Valheim-style interactive ripples
///
/// Simulates a 2D wave equation on a `GRID_SIZE × GRID_SIZE` CPU buffer and uploads
/// the result to a GPU texture every frame.  Objects that move through water inject
/// height impulses into the buffer; the wave equation propagates them outward.
///
/// The texture is exposed as [`WaterDisplacementTexture`] so other systems can:
/// - Query accurate water surface height for buoyancy calculations
/// - (Future) Bind the texture to a custom water material for vertex displacement
///
/// Performance: 256×256 grid, ~0.3 ms per frame on a modern CPU.
use bevy::prelude::*;
use bevy::render::render_resource::{
    Extent3d, TextureDescriptor, TextureDimension, TextureFormat, TextureUsages,
};

use crate::camera::controller::PlayerCamera;
use crate::constants::WATER_LEVEL;
use crate::rendering::capabilities::GraphicsCapabilities;
use crate::rendering::water::WaterConfig;

/// Side length of the simulation grid (cells).
pub const GRID_SIZE: usize = 256;
/// World-space area covered by one full grid dimension (metres).
pub const WORLD_SIZE: f32 = 128.0;

// ─── Public resources ────────────────────────────────────────────────────────

/// The displacement texture read by the water vertex / fragment shaders.
/// R = displacement height (metres), G = unused (velocity kept CPU-side only).
#[derive(Resource)]
pub struct WaterDisplacementTexture {
    pub image: Handle<Image>,
}

// ─── Internal simulation state ────────────────────────────────────────────────

#[derive(Resource)]
struct DisplacementState {
    height: Vec<f32>,
    velocity: Vec<f32>,
    /// World-space XZ centre of the simulation (follows the camera each frame).
    center: Vec2,
    /// Pending impulses: (grid_x, grid_y, strength, radius_cells).
    impulses: Vec<(i32, i32, f32, f32)>,
}

impl Default for DisplacementState {
    fn default() -> Self {
        Self {
            height: vec![0.0; GRID_SIZE * GRID_SIZE],
            velocity: vec![0.0; GRID_SIZE * GRID_SIZE],
            center: Vec2::ZERO,
            impulses: Vec::new(),
        }
    }
}

impl DisplacementState {
    /// Convert a world-space XZ position to grid coordinates.
    /// Returns `None` if outside the current simulation area.
    pub fn world_to_grid(&self, world_xz: Vec2) -> Option<(i32, i32)> {
        let half = WORLD_SIZE * 0.5;
        let rel = world_xz - self.center + Vec2::splat(half);
        let cell_size = WORLD_SIZE / GRID_SIZE as f32;
        let gx = (rel.x / cell_size) as i32;
        let gy = (rel.y / cell_size) as i32;
        let n = GRID_SIZE as i32;
        if gx >= 0 && gx < n && gy >= 0 && gy < n {
            Some((gx, gy))
        } else {
            None
        }
    }

    /// Sample the height at a world-space XZ position (bilinear interpolation).
    pub fn sample_height(&self, world_xz: Vec2) -> f32 {
        let half = WORLD_SIZE * 0.5;
        let cell_size = WORLD_SIZE / GRID_SIZE as f32;
        let rel = world_xz - self.center + Vec2::splat(half);
        let fx = rel.x / cell_size - 0.5;
        let fy = rel.y / cell_size - 0.5;
        let x0 = fx.floor() as i32;
        let y0 = fy.floor() as i32;
        let tx = fx - fx.floor();
        let ty = fy - fy.floor();
        let n = GRID_SIZE as i32;
        let get = |x: i32, y: i32| -> f32 {
            let cx = x.clamp(0, n - 1) as usize;
            let cy = y.clamp(0, n - 1) as usize;
            self.height[cy * GRID_SIZE + cx]
        };
        let h00 = get(x0, y0);
        let h10 = get(x0 + 1, y0);
        let h01 = get(x0, y0 + 1);
        let h11 = get(x0 + 1, y0 + 1);
        h00 * (1.0 - tx) * (1.0 - ty)
            + h10 * tx * (1.0 - ty)
            + h01 * (1.0 - tx) * ty
            + h11 * tx * ty
    }

    /// Queue a circular impulse at grid position (gx, gy).
    pub fn add_impulse(&mut self, gx: i32, gy: i32, strength: f32, radius: f32) {
        self.impulses.push((gx, gy, strength, radius));
    }

    /// Apply all queued impulses then clear the list.
    fn flush_impulses(&mut self) {
        let n = GRID_SIZE as i32;
        for (cx, cy, strength, radius) in self.impulses.drain(..) {
            let r = radius.ceil() as i32;
            for dy in -r..=r {
                for dx in -r..=r {
                    let gx = cx + dx;
                    let gy = cy + dy;
                    if gx < 0 || gy < 0 || gx >= n || gy >= n {
                        continue;
                    }
                    let dist = ((dx * dx + dy * dy) as f32).sqrt();
                    if dist > radius {
                        continue;
                    }
                    let falloff = 1.0 - (dist / radius).powi(2);
                    let idx = gy as usize * GRID_SIZE + gx as usize;
                    self.velocity[idx] += strength * falloff;
                }
            }
        }
    }

    /// Advance the wave simulation by one step.
    fn step(&mut self, wave_speed: f32, damping: f32) {
        let n = GRID_SIZE;
        self.flush_impulses();

        let mut new_height = self.height.clone();
        let mut new_velocity = self.velocity.clone();

        for y in 0..n {
            for x in 0..n {
                let idx = y * n + x;
                let h = self.height[idx];
                let v = self.velocity[idx];

                let left  = if x > 0 { self.height[idx - 1] } else { h };
                let right = if x < n - 1 { self.height[idx + 1] } else { h };
                let up    = if y > 0 { self.height[idx - n] } else { h };
                let down  = if y < n - 1 { self.height[idx + n] } else { h };

                let laplacian = (left + right + up + down) * 0.25 - h;
                let nv = (v + laplacian * wave_speed) * damping;
                let nh = (h + nv).clamp(-2.0, 2.0);
                new_velocity[idx] = nv;
                new_height[idx] = nh;
            }
        }
        self.height = new_height;
        self.velocity = new_velocity;
    }

    /// Write the height field into a flat RGBA8 pixel buffer (R=height encoded, GB=0, A=255).
    /// Height is mapped from [-2, 2] → [0, 255] for storage.
    fn write_to_rgba8(&self, buf: &mut Vec<u8>) {
        buf.clear();
        buf.reserve(GRID_SIZE * GRID_SIZE * 4);
        for &h in &self.height {
            // Encode [-2, 2] -> [0, 255]
            let encoded = ((h / 4.0 + 0.5) * 255.0).clamp(0.0, 255.0) as u8;
            buf.push(encoded); // R: height
            buf.push(0);       // G: unused
            buf.push(0);       // B: unused
            buf.push(255);     // A: opaque
        }
    }
}

// ─── Component for impulse sources ───────────────────────────────────────────

/// Add this component to any entity that should create water ripples when it
/// moves through water (players, falling objects, boat hulls, etc.).
#[derive(Component)]
pub struct WaterImpulseSource {
    /// Radius of the ripple splash in world units.
    pub radius: f32,
    /// Peak downward velocity applied at the impulse centre.
    pub strength: f32,
    /// Minimum movement per frame to trigger a new impulse (avoids idle ripples).
    pub min_move_distance: f32,
    last_xz: Option<Vec2>,
}

impl WaterImpulseSource {
    pub fn new(radius: f32, strength: f32) -> Self {
        Self {
            radius,
            strength,
            min_move_distance: 0.3,
            last_xz: None,
        }
    }
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

pub struct WaterDisplacementPlugin;

impl Plugin for WaterDisplacementPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<DisplacementState>()
            .add_systems(
                Startup,
                setup_displacement_texture,
            )
            .add_systems(
                Update,
                (
                    update_displacement_center,
                    collect_impulses,
                    step_and_upload_displacement,
                )
                    .chain()
                    .run_if(resource_exists::<WaterDisplacementTexture>),
            );
    }
}

// ─── Systems ─────────────────────────────────────────────────────────────────

fn setup_displacement_texture(
    mut commands: Commands,
    mut images: ResMut<Assets<Image>>,
    capabilities: Option<Res<GraphicsCapabilities>>,
    water_config: Option<Res<WaterConfig>>,
) {
    // Skip on integrated GPU
    let integrated = capabilities.as_ref().map(|c| c.integrated_gpu).unwrap_or(false);
    let enabled = water_config
        .as_ref()
        .map(|c| c.displacement.enabled)
        .unwrap_or(true);

    if integrated || !enabled {
        info!("Water displacement disabled (integrated GPU or config)");
        return;
    }

    let n = GRID_SIZE as u32;
    let size = Extent3d { width: n, height: n, depth_or_array_layers: 1 };

    let mut image = Image {
        texture_descriptor: TextureDescriptor {
            label: Some("water_displacement_texture"),
            size,
            dimension: TextureDimension::D2,
            format: TextureFormat::Rgba8Unorm,
            mip_level_count: 1,
            sample_count: 1,
            usage: TextureUsages::TEXTURE_BINDING | TextureUsages::COPY_DST,
            view_formats: &[],
        },
        ..default()
    };
    image.resize(size);
    // Initialise to mid-grey (zero displacement)
    image.data.as_mut().unwrap().fill(128);

    let handle = images.add(image);
    commands.insert_resource(WaterDisplacementTexture { image: handle });
    info!(
        "Water displacement texture created ({}×{}, {:.0}m coverage)",
        n, n, WORLD_SIZE
    );
}

/// Keep the simulation grid centred on the player camera.
fn update_displacement_center(
    camera: Query<&Transform, With<PlayerCamera>>,
    mut state: ResMut<DisplacementState>,
) {
    let Ok(cam) = camera.single() else { return };
    let new_center = Vec2::new(cam.translation.x, cam.translation.z);
    // Snap center in 0.5-cell increments to reduce texture swimming
    let cell_size = WORLD_SIZE / GRID_SIZE as f32;
    let snapped = (new_center / cell_size).round() * cell_size;
    state.center = snapped;
}

/// Write impulses for every WaterImpulseSource that moved while in water.
fn collect_impulses(
    mut sources: Query<(&GlobalTransform, &mut WaterImpulseSource)>,
    mut state: ResMut<DisplacementState>,
) {
    let water_y = WATER_LEVEL as f32;
    for (gtf, mut src) in sources.iter_mut() {
        let pos = gtf.translation();
        // Only entities that are near/below the water surface
        if pos.y > water_y + 0.5 {
            src.last_xz = None;
            continue;
        }
        let xz = Vec2::new(pos.x, pos.z);
        let moved = src
            .last_xz
            .map(|prev| (xz - prev).length())
            .unwrap_or(f32::MAX);

        if moved >= src.min_move_distance {
            if let Some((gx, gy)) = state.world_to_grid(xz) {
                let cell_radius = src.radius / (WORLD_SIZE / GRID_SIZE as f32);
                state.add_impulse(gx, gy, -src.strength, cell_radius);
            }
            src.last_xz = Some(xz);
        }
    }
}

/// Advance the simulation and upload the height field to the GPU texture.
/// Throttled to every 2nd frame. Skips entirely when the simulation has settled
/// (no active impulses and all energy has damped out).
fn step_and_upload_displacement(
    water_config: Option<Res<WaterConfig>>,
    displacement_tex: Res<WaterDisplacementTexture>,
    mut state: ResMut<DisplacementState>,
    mut images: ResMut<Assets<Image>>,
    mut frame_counter: Local<u32>,
    mut settled: Local<bool>,
) {
    *frame_counter = frame_counter.wrapping_add(1);

    // Check if simulation has settled (no impulses and max height < threshold)
    let has_impulses = !state.impulses.is_empty();
    if !has_impulses {
        let max_energy = state.height.iter().map(|h| h.abs()).fold(0.0f32, f32::max)
            + state.velocity.iter().map(|v| v.abs()).fold(0.0f32, f32::max);
        if max_energy < 0.001 {
            if !*settled {
                *settled = true;
            }
            return; // Nothing to simulate — skip entirely
        }
    } else {
        *settled = false;
    }

    // Throttle to every 2nd frame — wave simulation is smooth enough at half rate
    if *frame_counter % 2 != 0 {
        return;
    }

    let config = water_config
        .as_ref()
        .map(|c| c.displacement.clone())
        .unwrap_or_default();

    state.step(config.wave_speed, config.damping);

    if let Some(image) = images.get_mut(&displacement_tex.image) {
        let buf = image.data.as_mut().unwrap();
        state.write_to_rgba8(buf);
    }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/// Query the water surface displacement height (in metres) at any world XZ position.
/// Returns 0.0 if the displacement system is not active.
pub fn sample_water_displacement(state: &DisplacementState, world_xz: Vec2) -> f32 {
    state.sample_height(world_xz)
}
