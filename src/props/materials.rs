use super::{Prop, PropConfig, PropType};
use crate::props::foliage::FoliageFade;
use bevy::color::Alpha;
use bevy::prelude::*;

/// Marker: prop has been styled
#[derive(Component)]
pub struct StyledProp;

/// Apply material overrides to GLTF props for consistent visual style
pub fn apply_style_overrides(
    mut commands: Commands,
    config: Res<PropConfig>,
    props: Query<(Entity, &Prop), Without<StyledProp>>,
    children: Query<&Children>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    material_handles: Query<&MeshMaterial3d<StandardMaterial>>,
) {
    for (entity, prop) in props.iter() {
        // Traverse hierarchy and apply material tweaks
        let processed = apply_to_hierarchy(
            entity,
            &children,
            &material_handles,
            &mut materials,
            &mut commands,
            &config.style,
            prop.prop_type,
            &prop.id,
        );

        let has_children = children.get(entity).map(|kids| !kids.is_empty()).unwrap_or(false);
        if processed || has_children {
            commands.entity(entity).insert(StyledProp);
        }
    }
}

fn apply_to_hierarchy(
    entity: Entity,
    children: &Query<&Children>,
    material_handles: &Query<&MeshMaterial3d<StandardMaterial>>,
    materials: &mut Assets<StandardMaterial>,
    commands: &mut Commands,
    style: &super::StyleConfig,
    prop_type: PropType,
    prop_id: &str,
) -> bool {
    let mut processed = false;

    // Apply to this entity if it has a material
    if let Ok(mat_handle) = material_handles.get(entity) {
        processed = true;
        let (should_fade, base_alpha) = if let Some(mat) = materials.get_mut(&mat_handle.0) {
            let original_alpha_mode = mat.alpha_mode;
            tweak_material(mat, style, prop_type, prop_id);

            let force_blend = should_force_blend(prop_type, prop_id);
            let should_fade = matches!(prop_type, PropType::Bush | PropType::Flower)
                && (force_blend || matches!(original_alpha_mode, AlphaMode::Mask(_) | AlphaMode::Blend));

            if should_fade {
                let base_alpha = mat.base_color.alpha();
                (true, base_alpha)
            } else {
                (false, 0.0)
            }
        } else {
            (false, 0.0)
        };

        if should_fade {
                let (min_alpha_scale, distance_scale) = foliage_fade_scales(prop_type, prop_id);
                let bounds_radius = foliage_bounds_radius(distance_scale);
                commands.entity(entity).insert(FoliageFade {
                    base_alpha,
                    current_alpha: base_alpha,
                    min_alpha_scale,
                    distance_scale,
                    bounds_radius,
                    base_material: mat_handle.0.clone(),
                    blended_material: None,
                });
            }
        }

    // Recurse into children
    if let Ok(kids) = children.get(entity) {
        for child in kids.iter() {
            processed |= apply_to_hierarchy(
                child,
                children,
                material_handles,
                materials,
                commands,
                style,
                prop_type,
                prop_id,
            );
        }
    }

    processed
}

fn is_foliage_prop(prop_type: PropType) -> bool {
    matches!(prop_type, PropType::Tree | PropType::Bush | PropType::Flower)
}

fn should_force_blend(prop_type: PropType, prop_id: &str) -> bool {
    if matches!(prop_type, PropType::Bush | PropType::Flower) {
        return true;
    }
    let id = prop_id.to_lowercase();
    id.contains("grass") || id.contains("fern") || id.contains("shrub")
}

fn foliage_fade_scales(prop_type: PropType, prop_id: &str) -> (f32, f32) {
    if is_grass_like_foliage(prop_type, prop_id) {
        (0.2, 2.5)
    } else if matches!(prop_type, PropType::Bush | PropType::Flower) {
        (0.6, 2.0)
    } else {
        (1.0, 1.0)
    }
}

fn foliage_bounds_radius(distance_scale: f32) -> f32 {
    (distance_scale * 0.75).clamp(0.5, 3.0)
}

fn is_grass_like_foliage(prop_type: PropType, prop_id: &str) -> bool {
    if prop_type != PropType::Bush {
        return false;
    }
    let id = prop_id.to_lowercase();
    id.contains("grass") || id.contains("fern") || id.contains("shrub")
}

fn tweak_material(
    mat: &mut StandardMaterial,
    style: &super::StyleConfig,
    prop_type: PropType,
    prop_id: &str,
) {
    let is_custom = prop_id.starts_with("custom_");

    apply_common_style(mat, style);

    // Type-specific adjustments (GLTF material values preserved)
    match prop_type {
        PropType::Tree => {
            // Leaves: double-sided, higher alpha threshold for solid look
            mat.diffuse_transmission = 0.0;
            mat.double_sided = true;
            mat.cull_mode = None;
            mat.alpha_mode = AlphaMode::Mask(0.5);
        }
        PropType::Rock => {
            // Rocks: use GLTF values, just ensure no transmission
            mat.diffuse_transmission = 0.0;
        }
        PropType::Bush | PropType::Flower => {
            // Foliage: alpha mask, double-sided, solid look
            mat.double_sided = true;
            mat.cull_mode = None;
            mat.diffuse_transmission = 0.0;
            if !is_custom {
                mat.alpha_mode = AlphaMode::Mask(0.5);
            }
        }
    }

    if matches!(prop_type, PropType::Bush | PropType::Flower) && is_custom {
        apply_custom_foliage_style(mat, &style.custom);
    }

    if matches!(prop_type, PropType::Bush | PropType::Flower) && style.foliage_brightness_max > 0.0 {
        mat.base_color = clamp_luminance(mat.base_color, style.foliage_brightness_max);
    }
}

fn apply_common_style(mat: &mut StandardMaterial, style: &super::StyleConfig) {
    mat.base_color = boost_saturation(mat.base_color, style.saturation_boost);
    mat.perceptual_roughness = mat.perceptual_roughness.max(style.roughness_min);
    mat.metallic = mat.metallic.min(style.metallic_max);
}

fn apply_custom_foliage_style(mat: &mut StandardMaterial, style: &super::CustomStyleConfig) {
    mat.base_color = boost_saturation(mat.base_color, style.saturation_boost);
    mat.base_color = adjust_brightness(mat.base_color, style.brightness_boost);
    mat.perceptual_roughness = mat.perceptual_roughness.max(style.roughness_min);
    mat.metallic = mat.metallic.min(style.metallic_max);
    if style.disable_normal_maps {
        mat.normal_map_texture = None;
    }
    if style.disable_occlusion_maps {
        mat.occlusion_texture = None;
    }
}

fn boost_saturation(color: Color, boost: f32) -> Color {
    if boost == 0.0 {
        return color;
    }

    let linear = color.to_linear();
    let luma = linear.red * 0.2126 + linear.green * 0.7152 + linear.blue * 0.0722;
    let factor = (1.0 + boost).max(0.0);

    let red = (luma + (linear.red - luma) * factor).clamp(0.0, 1.0);
    let green = (luma + (linear.green - luma) * factor).clamp(0.0, 1.0);
    let blue = (luma + (linear.blue - luma) * factor).clamp(0.0, 1.0);

    Color::linear_rgba(red, green, blue, linear.alpha)
}

fn adjust_brightness(color: Color, amount: f32) -> Color {
    if amount == 0.0 {
        return color;
    }

    let linear = color.to_linear();
    let amount = amount.clamp(-1.0, 1.0);
    let (red, green, blue) = if amount >= 0.0 {
        (
            linear.red + (1.0 - linear.red) * amount,
            linear.green + (1.0 - linear.green) * amount,
            linear.blue + (1.0 - linear.blue) * amount,
        )
    } else {
        let t = -amount;
        (
            linear.red * (1.0 - t),
            linear.green * (1.0 - t),
            linear.blue * (1.0 - t),
        )
    };

    Color::linear_rgba(red.clamp(0.0, 1.0), green.clamp(0.0, 1.0), blue.clamp(0.0, 1.0), linear.alpha)
}

fn clamp_luminance(color: Color, max_luma: f32) -> Color {
    let linear = color.to_linear();
    let luma = linear.red * 0.2126 + linear.green * 0.7152 + linear.blue * 0.0722;
    if luma <= max_luma || luma <= 0.0001 {
        return color;
    }
    let scale = (max_luma / luma).clamp(0.0, 1.0);
    let red = (linear.red * scale).clamp(0.0, 1.0);
    let green = (linear.green * scale).clamp(0.0, 1.0);
    let blue = (linear.blue * scale).clamp(0.0, 1.0);
    Color::linear_rgba(red, green, blue, linear.alpha)
}
