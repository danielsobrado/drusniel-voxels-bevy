use crate::app::runtime_lock::RuntimeInstanceKind;
use crate::diagnostics::bench::{BenchCli, BenchConfig};

fn env_flag(name: &str) -> bool {
    matches!(
        std::env::var(name).as_deref(),
        Ok("1") | Ok("true") | Ok("TRUE") | Ok("yes") | Ok("on")
    )
}

pub(super) fn editor_runtime_requested(cli: &BenchCli) -> bool {
    cli.editor_runtime || env_flag("DRUSNIEL_EDITOR_RUNTIME")
}

pub(super) fn editor_native_viewport_requested(cli: &BenchCli) -> bool {
    cli.editor_native_viewport || env_flag("DRUSNIEL_EDITOR_NATIVE_VIEWPORT")
}

pub(super) fn runtime_instance_kind(
    editor_runtime: bool,
    editor_native_viewport: bool,
    bench_config: Option<&BenchConfig>,
) -> RuntimeInstanceKind {
    if editor_runtime && !editor_native_viewport {
        RuntimeInstanceKind::EditorRuntime
    } else if editor_native_viewport {
        RuntimeInstanceKind::EditorNativeViewport
    } else if bench_config.is_some() {
        RuntimeInstanceKind::Bench
    } else {
        RuntimeInstanceKind::Game
    }
}
