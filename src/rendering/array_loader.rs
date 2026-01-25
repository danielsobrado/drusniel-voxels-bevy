use bevy::prelude::*;
use bevy::asset::RenderAssetUsages;
use bevy::image::{ImageAddressMode, ImageFilterMode, ImageSampler, ImageSamplerDescriptor};
use bevy::render::render_resource::{
    Extent3d, TextureDataOrder, TextureDescriptor, TextureDimension, TextureFormat, TextureViewDescriptor, TextureViewDimension, TextureUsages,
};
use std::fs;
use std::path::Path;

use crate::rendering::blocky_material::{BlockyMaterial, BlockyMaterialHandle};
use crate::rendering::materials::VoxelMaterial;
use crate::rendering::mipmaps::{calculate_mip_count, generate_array_mipmaps_rgba8};
use crate::constants::{ATLAS_TILE_SIZE, ATLAS_COLUMNS};

/// Resource to track atlas loading state
#[derive(Resource)]
pub struct TextureArraySource {
    pub atlas: Handle<Image>,
    pub loaded: bool,
}

#[derive(Resource)]
pub struct BlockyTextureArray {
    pub albedo: Handle<Image>,
    pub normal: Option<Handle<Image>>, // Optional - disabled due to binding conflict with Bevy's PBR
}

/// Atlas tile mapping configuration - maps texture array layers to atlas tile indices
/// This can be modified at runtime via the settings UI and saved to YAML
/// Mapping for a single block type (Top, Side, Bottom)
#[derive(Clone, Copy, Debug)]
pub struct BlockAtlasMap {
    pub top: u32,
    pub side: u32,
    pub bottom: u32,
}

impl Default for BlockAtlasMap {
    fn default() -> Self {
        Self { top: 0, side: 0, bottom: 0 }
    }
}

/// Atlas tile mapping configuration - maps texture array layers to atlas tile indices
/// This can be modified at runtime via the settings UI and saved to YAML
#[derive(Resource, Clone)]
pub struct AtlasMapping {
    pub grass: BlockAtlasMap,
    pub dirt: BlockAtlasMap,
    pub rock: BlockAtlasMap,
    pub sand: BlockAtlasMap,
    /// Flag to trigger texture array rebuild
    pub needs_rebuild: bool,
}

impl Default for AtlasMapping {
    fn default() -> Self {
        Self {
            grass: BlockAtlasMap { top: 3, side: 7, bottom: 0 },
            dirt: BlockAtlasMap { top: 0, side: 0, bottom: 0 },
            rock: BlockAtlasMap { top: 1, side: 1, bottom: 1 },
            sand: BlockAtlasMap { top: 4, side: 4, bottom: 4 },
            needs_rebuild: false,
        }
    }
}

impl AtlasMapping {
    /// Load mapping from YAML config file
    pub fn load_from_yaml() -> Self {
        let config_path = Path::new("config/blocky_textures.yaml");
        if !config_path.exists() {
            info!("No blocky_textures.yaml found, using defaults");
            return Self::default();
        }

        match fs::read_to_string(config_path) {
            Ok(contents) => {
                let mut mapping = Self::default();

                if let Some(atlas_section) = contents.find("atlas_mapping:") {
                    let section = &contents[atlas_section..];

                    // Helper to parse line "  grass: { top: 3, side: 7, bottom: 0 }"
                    for line in section.lines().skip(1) {
                        let line = line.trim();
                        if line.starts_with("grass:") {
                            if let Some(map) = parse_block_map(line) { mapping.grass = map; }
                        } else if line.starts_with("dirt:") {
                            if let Some(map) = parse_block_map(line) { mapping.dirt = map; }
                        } else if line.starts_with("rock:") {
                            if let Some(map) = parse_block_map(line) { mapping.rock = map; }
                        } else if line.starts_with("sand:") {
                            if let Some(map) = parse_block_map(line) { mapping.sand = map; }
                        }
                    }
                }
                info!(
                    "Loaded AtlasMapping from YAML: grass({},{},{}), dirt({},{},{}), rock({},{},{}), sand({},{},{})",
                    mapping.grass.top, mapping.grass.side, mapping.grass.bottom,
                    mapping.dirt.top, mapping.dirt.side, mapping.dirt.bottom,
                    mapping.rock.top, mapping.rock.side, mapping.rock.bottom,
                    mapping.sand.top, mapping.sand.side, mapping.sand.bottom
                );
                mapping
            }
            Err(e) => {
                warn!("Failed to read blocky_textures.yaml: {}", e);
                Self::default()
            }
        }
    }

    /// Save mapping to YAML config file
    pub fn save_to_yaml(&self) -> Result<(), String> {
        let config_path = Path::new("config/blocky_textures.yaml");

        // Read existing file or create new content
        let mut contents = if config_path.exists() {
            fs::read_to_string(config_path).unwrap_or_default()
        } else {
            String::new()
        };

        // Remove existing atlas_mapping section if present
        if let Some(start) = contents.find("# Atlas tile mapping") {
            if let Some(end) = contents[start..].find("\n\n") {
                contents = format!("{}{}", &contents[..start], &contents[start + end..]);
            }
        }
        if let Some(start) = contents.find("atlas_mapping:") {
            // Find the end of this section (next section or end of file)
            let section_end = contents[start..]
                .find("\n\n")
                .map(|i| start + i)
                .unwrap_or(contents.len());
            contents = format!("{}{}", &contents[..start], &contents[section_end..]);
        }

        // Append our atlas_mapping section
        let mapping_yaml = format!(
r#"
# Atlas tile mapping (editable via in-game UI)
# Each block type has {{ top, side, bottom }} atlas tile indices
atlas_mapping:
  grass: {{ top: {}, side: {}, bottom: {} }}
  dirt: {{ top: {}, side: {}, bottom: {} }}
  rock: {{ top: {}, side: {}, bottom: {} }}
  sand: {{ top: {}, side: {}, bottom: {} }}
"#,
            self.grass.top, self.grass.side, self.grass.bottom,
            self.dirt.top, self.dirt.side, self.dirt.bottom,
            self.rock.top, self.rock.side, self.rock.bottom,
            self.sand.top, self.sand.side, self.sand.bottom,
        );

        contents.push_str(&mapping_yaml);

        // Write back
        fs::write(config_path, contents).map_err(|e| format!("Failed to write config: {}", e))?;

        info!("Saved atlas mapping to config/blocky_textures.yaml");
        Ok(())
    }

    /// Get tile indices as array for texture extraction
    pub fn as_tile_indices(&self) -> [u32; 12] {
        [
            self.grass.top, self.grass.side, self.grass.bottom,
            self.dirt.top, self.dirt.side, self.dirt.bottom,
            self.rock.top, self.rock.side, self.rock.bottom,
            self.sand.top, self.sand.side, self.sand.bottom,
        ]
    }
}

fn parse_block_map(line: &str) -> Option<BlockAtlasMap> {
    // Line format: "grass: { top: 0, side: 7, bottom: 0 }"
    // Find the opening brace and extract everything between { and }
    let start = line.find('{')?;
    let end = line.find('}')?;
    let content = &line[start + 1..end];

    let mut map = BlockAtlasMap::default();

    for part in content.split(',') {
        let part = part.trim();
        if let Some(idx) = part.find(':') {
            let key = part[..idx].trim();
            let val = part[idx + 1..].trim().parse::<u32>().ok()?;

            match key {
                "top" => map.top = val,
                "side" => map.side = val,
                "bottom" => map.bottom = val,
                _ => {}
            }
        }
    }
    Some(map)
}

/// Extract a single tile from the atlas as RGBA8 data
fn extract_tile_from_atlas(
    atlas_data: &[u8],
    atlas_width: u32,
    atlas_height: u32,
    tile_idx: u32,
    tile_size: u32,
    columns: u32,
    format: TextureFormat,
) -> Vec<u8> {
    let tile_col = tile_idx % columns;
    let tile_row = tile_idx / columns;
    let tile_x = tile_col * tile_size;
    let tile_y = tile_row * tile_size;

    // Determine bytes per pixel based on format
    let (bpp, is_16bit) = match format {
        TextureFormat::Rgba8Unorm | TextureFormat::Rgba8UnormSrgb => (4, false),
        TextureFormat::Rgba16Unorm | TextureFormat::Rgba16Float => (8, true),
        _ => {
            // Fallback: infer from data size
            let total_pixels = (atlas_width * atlas_height) as usize;
            let bpp = atlas_data.len() / total_pixels;
            (bpp, bpp == 8)
        }
    };

    let mut tile_data = Vec::with_capacity((tile_size * tile_size * 4) as usize);

    for y in 0..tile_size {
        for x in 0..tile_size {
            let atlas_x = tile_x + x;
            let atlas_y = tile_y + y;

            // Bounds check
            if atlas_x >= atlas_width || atlas_y >= atlas_height {
                // Out of bounds - use magenta for debug
                tile_data.extend_from_slice(&[255, 0, 255, 255]);
                continue;
            }

            let pixel_idx = (atlas_y * atlas_width + atlas_x) as usize;
            let byte_offset = pixel_idx * bpp;

            if is_16bit {
                // Convert Rgba16 to Rgba8
                if byte_offset + 7 < atlas_data.len() {
                    let r16 = u16::from_le_bytes([atlas_data[byte_offset], atlas_data[byte_offset + 1]]);
                    let g16 = u16::from_le_bytes([atlas_data[byte_offset + 2], atlas_data[byte_offset + 3]]);
                    let b16 = u16::from_le_bytes([atlas_data[byte_offset + 4], atlas_data[byte_offset + 5]]);
                    let a16 = u16::from_le_bytes([atlas_data[byte_offset + 6], atlas_data[byte_offset + 7]]);
                    tile_data.push((r16 / 257) as u8);
                    tile_data.push((g16 / 257) as u8);
                    tile_data.push((b16 / 257) as u8);
                    tile_data.push((a16 / 257) as u8);
                } else {
                    tile_data.extend_from_slice(&[255, 0, 255, 255]);
                }
            } else {
                // Copy Rgba8 directly
                if byte_offset + 3 < atlas_data.len() {
                    tile_data.push(atlas_data[byte_offset]);
                    tile_data.push(atlas_data[byte_offset + 1]);
                    tile_data.push(atlas_data[byte_offset + 2]);
                    tile_data.push(atlas_data[byte_offset + 3]);
                } else if byte_offset + 2 < atlas_data.len() {
                    // RGB without alpha
                    tile_data.push(atlas_data[byte_offset]);
                    tile_data.push(atlas_data[byte_offset + 1]);
                    tile_data.push(atlas_data[byte_offset + 2]);
                    tile_data.push(255);
                } else {
                    tile_data.extend_from_slice(&[255, 0, 255, 255]);
                }
            }
        }
    }

    tile_data
}

/// Generate a flat normal map tile (pointing straight up)
/// Currently unused due to binding slot conflict with Bevy's default vertex shader
#[allow(dead_code)]
fn generate_flat_normal_tile(tile_size: u32) -> Vec<u8> {
    let pixel_count = (tile_size * tile_size) as usize;
    let mut data = Vec::with_capacity(pixel_count * 4);

    // Flat normal: (0.5, 0.5, 1.0) in normalized space = (128, 128, 255) in byte space
    for _ in 0..pixel_count {
        data.push(128); // R = X
        data.push(128); // G = Y
        data.push(255); // B = Z (pointing up)
        data.push(255); // A
    }

    data
}

pub fn start_loading_texture_arrays(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
) {
    // Load atlas mapping from YAML config
    let mapping = AtlasMapping::load_from_yaml();
    commands.insert_resource(mapping);

    commands.insert_resource(TextureArraySource {
        atlas: asset_server.load("textures/atlas.png"),
        loaded: false,
    });
}

pub fn create_texture_array(
    mut commands: Commands,
    mut source: ResMut<TextureArraySource>,
    mut mapping: ResMut<AtlasMapping>,
    asset_server: Res<AssetServer>,
    mut images: ResMut<Assets<Image>>,
    mut materials: ResMut<Assets<BlockyMaterial>>,
    existing_handle: Option<ResMut<BlockyMaterialHandle>>,
) {
    // Check if we need to rebuild due to mapping change
    let needs_rebuild = mapping.needs_rebuild;
    if needs_rebuild {
        mapping.needs_rebuild = false;
        source.loaded = false; // Force rebuild
        info!("Rebuilding texture array due to mapping change...");
    }

    if source.loaded {
        return;
    }

    // Check if atlas is loaded
    if !asset_server.is_loaded(&source.atlas) {
        return;
    }

    let Some(atlas_img) = images.get(&source.atlas) else {
        return;
    };

    // All loaded, create the arrays
    info!("Creating Texture Arrays for Blocky Material from atlas...");

    let atlas_width = atlas_img.width();
    let atlas_height = atlas_img.height();
    let atlas_format = atlas_img.texture_descriptor.format;
    let atlas_data = atlas_img.data.as_ref().expect("Atlas has no data");

    let tile_size = ATLAS_TILE_SIZE;
    let columns = ATLAS_COLUMNS;

    info!("Atlas: {}x{}, tile_size={}, format={:?}", atlas_width, atlas_height, tile_size, atlas_format);

    // Extract tiles for each layer using the current mapping
    // Texture array layers: 0=grass, 1=dirt, 2=rock, 3=sand, 4=grass_side
    let tile_indices = mapping.as_tile_indices();
    info!(
        "Using tile indices from AtlasMapping: grass({},{},{}), dirt({},{},{}), rock({},{},{}), sand({},{},{})",
        tile_indices[0], tile_indices[1], tile_indices[2],
        tile_indices[3], tile_indices[4], tile_indices[5],
        tile_indices[6], tile_indices[7], tile_indices[8],
        tile_indices[9], tile_indices[10], tile_indices[11]
    );

    let mut albedo_layers: Vec<Vec<u8>> = Vec::with_capacity(tile_indices.len());

    for &tile_idx in &tile_indices {
        let tile_data = extract_tile_from_atlas(
            atlas_data,
            atlas_width,
            atlas_height,
            tile_idx,
            tile_size,
            columns,
            atlas_format,
        );
        albedo_layers.push(tile_data);
        // Normal textures disabled - binding slot 3 conflicts with Bevy's default vertex shader
    }

    // Helper to create texture array from layer data
    let create_array_from_layers = |layer_data: &[Vec<u8>], images: &mut Assets<Image>| -> Option<Handle<Image>> {
        let width = tile_size;
        let height = tile_size;
        let num_layers = layer_data.len() as u32;
        let target_format = TextureFormat::Rgba8UnormSrgb;

        // Calculate mip count based on texture dimensions
        let mip_count = calculate_mip_count(width, height).min(8);

        info!(
            "Creating {}x{} texture array with {} layers, {} mip levels",
            width, height, num_layers, mip_count
        );

        // Generate mipmaps for all layers
        let data_with_mips = generate_array_mipmaps_rgba8(width, height, num_layers, layer_data, mip_count);

        let image = Image {
            data: Some(data_with_mips),
            data_order: TextureDataOrder::LayerMajor,
            texture_descriptor: TextureDescriptor {
                label: None,
                size: Extent3d {
                    width,
                    height,
                    depth_or_array_layers: num_layers,
                },
                mip_level_count: mip_count,
                sample_count: 1,
                dimension: TextureDimension::D2,
                format: target_format,
                usage: TextureUsages::TEXTURE_BINDING | TextureUsages::COPY_DST,
                view_formats: &[],
            },
            sampler: ImageSampler::Descriptor(ImageSamplerDescriptor {
                address_mode_u: ImageAddressMode::Repeat,
                address_mode_v: ImageAddressMode::Repeat,
                address_mode_w: ImageAddressMode::Repeat,
                mag_filter: ImageFilterMode::Linear,
                min_filter: ImageFilterMode::Linear,
                mipmap_filter: ImageFilterMode::Linear,
                anisotropy_clamp: 16,
                ..default()
            }),
            texture_view_descriptor: Some(TextureViewDescriptor {
                dimension: Some(TextureViewDimension::D2Array),
                mip_level_count: Some(mip_count),
                ..default()
            }),
            asset_usage: RenderAssetUsages::RENDER_WORLD | RenderAssetUsages::MAIN_WORLD,
            copy_on_resize: false,
        };

        Some(images.add(image))
    };

    let Some(albedo_array) = create_array_from_layers(&albedo_layers, &mut images) else {
        warn!("Failed to create albedo texture array");
        return;
    };

    // Normal texture array creation removed - binding slot 3 conflicts with Bevy's default vertex shader
    // We'll use the world normal from the PBR input instead

    commands.insert_resource(BlockyTextureArray {
        albedo: albedo_array.clone(),
        normal: None, // Normal textures disabled due to binding conflict
    });

    // Create or update the material
    if let Some(existing) = existing_handle {
        // Update existing material with new textures
        if let Some(mat) = materials.get_mut(&existing.handle) {
            mat.diffuse_texture = Some(albedo_array);
            info!("Updated existing BlockyMaterial with new textures");
        }
    } else {
        // Create new material
        let material = BlockyMaterial {
            uniforms: default(),
            diffuse_texture: Some(albedo_array),
        };

        let handle = materials.add(material);

        // Insert the handle so we can access it if needed
        commands.insert_resource(BlockyMaterialHandle { handle: handle.clone() });

        // CRITICAL: Insert VoxelMaterial resource so the rest of the app (meshing) can find it
        commands.insert_resource(VoxelMaterial { handle });
    }

    source.loaded = true;
    source.loaded = true;
    info!("Blocky Texture Array created with 12 layers (4 materials * 3 faces)");
}
