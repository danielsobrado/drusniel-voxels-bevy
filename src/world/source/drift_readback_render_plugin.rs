use bevy::core_pipeline::core_3d::graph::{Core3d, Node3d};
use bevy::prelude::*;
use bevy::render::render_graph::{RenderGraphExt, ViewNodeRunner};
use bevy::render::{Render, RenderApp, RenderStartup, RenderSystems};

use super::drift_readback_render::{
    GpuWorldSourceDriftReadbackLabel, GpuWorldSourceDriftReadbackNode,
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
            .init_resource::<GpuWorldSourceDriftReadbackRequest>()
            .add_systems(RenderStartup, init_gpu_world_source_drift_readback_pipeline)
            .add_systems(
                Render,
                prepare_gpu_world_source_drift_readback_dispatch
                    .in_set(RenderSystems::PrepareResources),
            )
            .add_systems(
                Render,
                decode_staged_gpu_world_source_drift_readback.in_set(RenderSystems::Cleanup),
            );
        render_app.add_render_graph_node::<ViewNodeRunner<GpuWorldSourceDriftReadbackNode>>(
            Core3d,
            GpuWorldSourceDriftReadbackLabel,
        );
        render_app.add_render_graph_edges(
            Core3d,
            (GpuWorldSourceDriftReadbackLabel, Node3d::StartMainPass),
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
