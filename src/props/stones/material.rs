//! Stone material setup.
//!
//! The procedural rock meshes carry `ATTRIBUTE_VDATA` for strata, moss/upness and cavity AO.
//! Runtime maps that data into vertex color for the shared instanced prop shader.

use bevy::mesh::VertexAttributeValues;
use bevy::prelude::*;

use crate::props::instanced_render::PropLocalBounds;
use crate::rendering::props_material::{PropsMaterial, PropsUniforms};

use super::rock_mesh::ATTRIBUTE_VDATA;

pub fn stone_props_material() -> PropsMaterial {
    PropsMaterial {
        uniforms: PropsUniforms {
            base_color: Color::srgb(0.86, 0.84, 0.78).to_linear(),
            default_roughness: 0.96,
            normal_intensity: 0.0,
            alpha_cutoff: 0.0,
            // The instanced prop shader treats this slot as "stone vertex data enabled".
            _padding: 1.0,
            ..default()
        },
        alpha_mode: AlphaMode::Opaque,
        ..default()
    }
}

pub fn prepare_stone_instancing_mesh(mut mesh: Mesh) -> (Mesh, PropLocalBounds) {
    let vertex_count = mesh
        .attribute(Mesh::ATTRIBUTE_POSITION)
        .and_then(|attribute| match attribute {
            VertexAttributeValues::Float32x3(values) => Some(values.len()),
            _ => None,
        })
        .unwrap_or_default();

    if mesh.attribute(Mesh::ATTRIBUTE_UV_0).is_none() {
        mesh.insert_attribute(Mesh::ATTRIBUTE_UV_0, vec![[0.0_f32, 0.0_f32]; vertex_count]);
    }

    if let Some(VertexAttributeValues::Float32x4(vdata)) = mesh.attribute(ATTRIBUTE_VDATA) {
        mesh.insert_attribute(Mesh::ATTRIBUTE_COLOR, vdata.clone());
    } else if mesh.attribute(Mesh::ATTRIBUTE_COLOR).is_none() {
        mesh.insert_attribute(
            Mesh::ATTRIBUTE_COLOR,
            vec![[1.0_f32, 0.5_f32, 0.0_f32, 1.0_f32]; vertex_count],
        );
    }

    let bounds = local_bounds_from_mesh(&mesh);
    (mesh, bounds)
}

fn local_bounds_from_mesh(mesh: &Mesh) -> PropLocalBounds {
    let Some(VertexAttributeValues::Float32x3(positions)) =
        mesh.attribute(Mesh::ATTRIBUTE_POSITION)
    else {
        return fallback_bounds();
    };
    if positions.is_empty() {
        return fallback_bounds();
    }

    let mut min = Vec3::splat(f32::INFINITY);
    let mut max = Vec3::splat(f32::NEG_INFINITY);
    for position in positions {
        let position = Vec3::from_array(*position);
        min = min.min(position);
        max = max.max(position);
    }

    let sphere_center = (min + max) * 0.5;
    let mut sphere_radius: f32 = 0.0;
    for position in positions {
        sphere_radius = sphere_radius.max(Vec3::from_array(*position).distance(sphere_center));
    }

    PropLocalBounds {
        min,
        max,
        sphere_center,
        sphere_radius,
    }
}

fn fallback_bounds() -> PropLocalBounds {
    PropLocalBounds {
        min: Vec3::splat(-1.0),
        max: Vec3::splat(1.0),
        sphere_center: Vec3::ZERO,
        sphere_radius: Vec3::ONE.length(),
    }
}
