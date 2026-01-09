use super::{Prop, PropConfig, PropType};
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
        // Mark as processed immediately to avoid reprocessing
        commands.entity(entity).insert(StyledProp);

        // Traverse hierarchy and apply material tweaks
        apply_to_hierarchy(
            entity,
            &children,
            &material_handles,
            &mut materials,
            &config.style,
            prop.prop_type,
        );
    }
}

fn apply_to_hierarchy(
    entity: Entity,
    children: &Query<&Children>,
    material_handles: &Query<&MeshMaterial3d<StandardMaterial>>,
    materials: &mut Assets<StandardMaterial>,
    style: &super::StyleConfig,
    prop_type: PropType,
) {
    // Apply to this entity if it has a material
    if let Ok(mat_handle) = material_handles.get(entity) {
        if let Some(mat) = materials.get_mut(&mat_handle.0) {
            tweak_material(mat, style, prop_type);
        }
    }

    // Recurse into children
    if let Ok(kids) = children.get(entity) {
        for child in kids.iter() {
            apply_to_hierarchy(child, children, material_handles, materials, style, prop_type);
        }
    }
}

fn tweak_material(mat: &mut StandardMaterial, style: &super::StyleConfig, prop_type: PropType) {
    // Boost saturation for Valheim's vibrant look
    let hsla: Hsla = mat.base_color.into();
    let boosted_saturation = (hsla.saturation + style.saturation_boost).clamp(0.0, 1.0);
    let boosted = Hsla::new(hsla.hue, boosted_saturation, hsla.lightness, hsla.alpha);
    mat.base_color = boosted.into();

    // Reduce specularity for matte, hand-painted look
    mat.perceptual_roughness = mat.perceptual_roughness.max(style.roughness_min);
    mat.metallic = mat.metallic.min(style.metallic_max);
    mat.reflectance = 0.1;

    // Type-specific adjustments
    match prop_type {
        PropType::Tree => {
            // Leaves: slight translucency, double-sided
            mat.diffuse_transmission = 0.2;
            mat.double_sided = true;
            mat.cull_mode = None;
            mat.alpha_mode = AlphaMode::Mask(0.35);
        }
        PropType::Rock => {
            // Rocks: very rough, no transmission
            mat.perceptual_roughness = 0.95;
            mat.diffuse_transmission = 0.0;
        }
        PropType::Bush | PropType::Flower => {
            // Foliage: alpha mask, double-sided
            mat.double_sided = true;
            mat.cull_mode = None;
            mat.alpha_mode = AlphaMode::Mask(0.5);
            mat.diffuse_transmission = 0.1;
        }
    }
}
