use bevy::asset::{load_internal_asset, uuid_handle};
use bevy::prelude::*;
use bevy::render::render_resource::{AsBindGroup, ShaderType};
use bevy::shader::Shader;
use bevy_shader::ShaderRef;
use bevy_ui_render::prelude::{UiMaterial, UiMaterialPlugin};

const LOADING_FLAMES_SHADER_HANDLE: Handle<Shader> =
    uuid_handle!("e0f8c4f6-7a7e-4c95-9d7f-5f1a9f0d8f90");

#[derive(Clone, Copy, Debug, ShaderType)]
pub struct LoadingFlamesUniform {
    pub time: f32,
    pub _time_padding: f32,
    pub resolution: Vec2,
    pub mouse: Vec2,
}

impl Default for LoadingFlamesUniform {
    fn default() -> Self {
        Self {
            time: 0.0,
            _time_padding: 0.0,
            resolution: Vec2::new(1280.0, 720.0),
            mouse: Vec2::ZERO,
        }
    }
}

#[derive(Asset, TypePath, AsBindGroup, Clone, Debug)]
pub struct LoadingFlamesMaterial {
    #[uniform(0)]
    pub uniform: LoadingFlamesUniform,
}

impl UiMaterial for LoadingFlamesMaterial {
    fn fragment_shader() -> ShaderRef {
        LOADING_FLAMES_SHADER_HANDLE.into()
    }
}

pub struct LoadingFlamesPlugin;

impl Plugin for LoadingFlamesPlugin {
    fn build(&self, app: &mut App) {
        load_internal_asset!(
            app,
            LOADING_FLAMES_SHADER_HANDLE,
            concat!(env!("CARGO_MANIFEST_DIR"), "/assets/shaders/loading_flames.wgsl"),
            Shader::from_wgsl
        );

        app.add_plugins(UiMaterialPlugin::<LoadingFlamesMaterial>::default());
    }
}
