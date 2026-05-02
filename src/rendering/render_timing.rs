use bevy::diagnostic::{DiagnosticsStore, FrameCount};
use bevy::prelude::*;
use bevy::render::{Render, RenderApp, RenderSystems, view::window::prepare_windows};
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use crate::performance::AreaTimingRecorder;

#[derive(Clone)]
struct RenderTimingSample {
    area: String,
    duration_us: u64,
}

#[derive(Resource, Clone, Default)]
pub struct RenderTimingSink {
    samples: Arc<Mutex<Vec<RenderTimingSample>>>,
}

impl RenderTimingSink {
    fn push(&self, area: impl Into<String>, duration_us: u64) {
        if let Ok(mut samples) = self.samples.lock() {
            samples.push(RenderTimingSample {
                area: area.into(),
                duration_us,
            });
        }
    }

    fn drain(&self) -> Vec<RenderTimingSample> {
        self.samples
            .lock()
            .map(|mut samples| samples.drain(..).collect())
            .unwrap_or_default()
    }
}

#[derive(Resource, Default)]
struct RenderTimingMarkers {
    starts: BTreeMap<&'static str, Instant>,
}

impl RenderTimingMarkers {
    fn begin(&mut self, key: &'static str) {
        self.starts.insert(key, Instant::now());
    }

    fn end(&mut self, key: &'static str, sink: &RenderTimingSink, area: &'static str) {
        let Some(start) = self.starts.remove(key) else {
            return;
        };
        sink.push(area, start.elapsed().as_micros() as u64);
    }
}

macro_rules! render_timing_pair {
    ($begin:ident, $end:ident, $key:literal, $area:literal) => {
        fn $begin(mut markers: ResMut<RenderTimingMarkers>) {
            markers.begin($key);
        }

        fn $end(mut markers: ResMut<RenderTimingMarkers>, sink: Res<RenderTimingSink>) {
            markers.end($key, &sink, $area);
        }
    };
}

render_timing_pair!(
    begin_prepare_assets,
    end_prepare_assets,
    "prepare_assets",
    "Render PrepareAssets CPU"
);
render_timing_pair!(
    begin_prepare_meshes,
    end_prepare_meshes,
    "prepare_meshes",
    "Render PrepareMeshes CPU"
);
render_timing_pair!(
    begin_present_acquire,
    end_present_acquire,
    "present_acquire",
    "Render Present Acquire CPU"
);
render_timing_pair!(
    begin_manage_views,
    end_manage_views,
    "manage_views",
    "Render ManageViews CPU"
);
render_timing_pair!(begin_queue, end_queue, "queue", "Render Queue CPU");
render_timing_pair!(
    begin_queue_meshes,
    end_queue_meshes,
    "queue_meshes",
    "Render QueueMeshes CPU"
);
render_timing_pair!(
    begin_phase_sort,
    end_phase_sort,
    "phase_sort",
    "Render PhaseSort CPU"
);
render_timing_pair!(begin_prepare, end_prepare, "prepare", "Render Prepare CPU");
render_timing_pair!(
    begin_prepare_resources,
    end_prepare_resources,
    "prepare_resources",
    "Render PrepareResources CPU"
);
render_timing_pair!(
    begin_prepare_bind_groups,
    end_prepare_bind_groups,
    "prepare_bind_groups",
    "Render PrepareBindGroups CPU"
);
render_timing_pair!(
    begin_render_graph,
    end_render_graph,
    "render_graph",
    "Render Graph CPU"
);

pub fn install_render_timing(app: &mut App) {
    let sink = RenderTimingSink::default();
    app.insert_resource(sink.clone())
        .add_plugins(bevy::render::diagnostic::RenderDiagnosticsPlugin)
        .add_systems(Update, drain_render_timing_samples);

    if let Some(render_app) = app.get_sub_app_mut(RenderApp) {
        render_app
            .insert_resource(sink)
            .init_resource::<RenderTimingMarkers>()
            .add_systems(
                Render,
                (
                    begin_prepare_assets.before(RenderSystems::PrepareAssets),
                    end_prepare_assets.after(RenderSystems::PrepareAssets),
                    begin_prepare_meshes.before(RenderSystems::PrepareMeshes),
                    end_prepare_meshes.after(RenderSystems::PrepareMeshes),
                    begin_manage_views.before(RenderSystems::ManageViews),
                    end_manage_views.after(RenderSystems::ManageViews),
                    begin_present_acquire.before(prepare_windows),
                    end_present_acquire.after(prepare_windows),
                    begin_queue.before(RenderSystems::Queue),
                    end_queue.after(RenderSystems::Queue),
                ),
            )
            .add_systems(
                Render,
                (
                    begin_queue_meshes.before(RenderSystems::QueueMeshes),
                    end_queue_meshes.after(RenderSystems::QueueMeshes),
                    begin_phase_sort.before(RenderSystems::PhaseSort),
                    end_phase_sort.after(RenderSystems::PhaseSort),
                    begin_prepare.before(RenderSystems::Prepare),
                    end_prepare.after(RenderSystems::Prepare),
                    begin_prepare_resources.before(RenderSystems::PrepareResources),
                    end_prepare_resources.after(RenderSystems::PrepareResources),
                    begin_prepare_bind_groups.before(RenderSystems::PrepareBindGroups),
                    end_prepare_bind_groups.after(RenderSystems::PrepareBindGroups),
                ),
            )
            .add_systems(
                Render,
                (
                    begin_render_graph.before(RenderSystems::Render),
                    end_render_graph.after(RenderSystems::Render),
                ),
            );
    }
}

fn drain_render_timing_samples(
    sink: Option<Res<RenderTimingSink>>,
    mut timing: Option<ResMut<AreaTimingRecorder>>,
    frame: Res<FrameCount>,
    diagnostics: Res<DiagnosticsStore>,
) {
    let Some(timing) = timing.as_deref_mut() else {
        return;
    };
    if !timing.enabled {
        return;
    }

    if let Some(sink) = sink {
        for sample in sink.drain() {
            timing.record_area(frame.0, sample.area, sample.duration_us);
        }
    }

    for diagnostic in diagnostics.iter() {
        let path = diagnostic.path().as_str();
        let Some(area) = render_diagnostic_area(path) else {
            continue;
        };
        let Some(value_ms) = diagnostic.value() else {
            continue;
        };
        if value_ms.is_finite() && value_ms >= 0.0 {
            timing.record_area(frame.0, area, (value_ms * 1000.0) as u64);
        }
    }
}

fn render_diagnostic_area(path: &str) -> Option<String> {
    let path = path.strip_prefix("render/")?;
    if let Some(span) = path.strip_suffix("/elapsed_gpu") {
        Some(format!("GPU {}", span.replace('/', " / ")))
    } else {
        path.strip_suffix("/elapsed_cpu")
            .map(|span| format!("RenderGraph CPU {}", span.replace('/', " / ")))
    }
}
