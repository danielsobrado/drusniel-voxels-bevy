use bevy::prelude::*;
use bevy::render::{Render, RenderApp, RenderStartup};

use super::drift_readback_render::{
    GpuWorldSourceDriftReadbackRequest, decode_staged_gpu_world_source_drift_readback,
    init_gpu_world_source_drift_readback_pipeline, prepare_gpu_world_source_drift_readback_dispatch,
};

#[derive(Default)]
pub struct GpuWorldSourceDriftReadbackPlugin;

impl Plugin for GpuWorldSourceDriftReadbackPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<GpuWorldSourceDriftReadbackRequest>();

        let Some(render_app) = app.get_sub_app_mut(RenderApp) else {
            warn!("WorldSource drift readback render app is unavailable; plugin registration skipped");
            return;
        };

        render_app
            .add_systems(RenderStartup, init_gpu_world_source_drift_readback_pipeline)
            .add_systems(
                Render,
                (
                    prepare_gpu_world_source_drift_readback_dispatch,
                    decode_staged_gpu_world_source_drift_readback,
                )
                    .chain(),
            );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plugin_is_constructible() {
        let _plugin = GpuWorldSourceDriftReadbackPlugin;
    }
}
