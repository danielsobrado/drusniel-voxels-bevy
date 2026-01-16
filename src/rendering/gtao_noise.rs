use bevy::prelude::*;
use bevy::asset::RenderAssetUsages;
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat};
use rand::Rng;

/// Generates a 4x4 blue noise texture for GTAO spatial-temporal dithering
pub fn generate_gtao_noise_texture() -> Image {
    let size = 4u32;
    let mut rng = rand::thread_rng();
    
    // Generate blue noise-like pattern (simple white noise for now)
    // For production, use a pre-computed blue noise texture
    let mut data = Vec::with_capacity((size * size * 4) as usize);
    
    for _ in 0..(size * size) {
        let value = rng.r#gen::<u8>();
        data.push(value); // R
        data.push(value); // G
        data.push(value); // B
        data.push(255);   // A
    }
    
    Image::new(
        Extent3d {
            width: size,
            height: size,
            depth_or_array_layers: 1,
        },
        TextureDimension::D2,
        data,
        TextureFormat::Rgba8Unorm,
        RenderAssetUsages::RENDER_WORLD,
    )
}

/// Plugin to setup GTAO noise texture resource
pub struct GtaoNoisePlugin;

impl Plugin for GtaoNoisePlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(Startup, setup_gtao_noise);
    }
}

#[derive(Resource)]
pub struct GtaoNoiseTexture(pub Handle<Image>);

fn setup_gtao_noise(
    mut commands: Commands,
    mut images: ResMut<Assets<Image>>,
) {
    let noise_texture = generate_gtao_noise_texture();
    let handle = images.add(noise_texture);
    
    commands.insert_resource(GtaoNoiseTexture(handle));
    info!("GTAO noise texture created");
}
