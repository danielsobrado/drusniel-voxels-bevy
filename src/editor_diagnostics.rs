use std::collections::BTreeSet;

use bevy::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum EditorDiagnosticsCategory {
    NativeViewport,
    Frontend,
    Input,
    Selection,
    Hover,
    Highlight,
    Runtime,
}

impl EditorDiagnosticsCategory {
    pub const ALL: [Self; 7] = [
        Self::NativeViewport,
        Self::Frontend,
        Self::Input,
        Self::Selection,
        Self::Hover,
        Self::Highlight,
        Self::Runtime,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Self::NativeViewport => "nativeViewport",
            Self::Frontend => "frontend",
            Self::Input => "input",
            Self::Selection => "selection",
            Self::Hover => "hover",
            Self::Highlight => "highlight",
            Self::Runtime => "runtime",
        }
    }
}

#[derive(Resource, Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorDiagnosticsState {
    pub enabled: bool,
    pub categories: BTreeSet<EditorDiagnosticsCategory>,
}

impl Default for EditorDiagnosticsState {
    fn default() -> Self {
        Self {
            enabled: diagnostics_env_enabled(),
            categories: all_editor_diagnostics_categories(),
        }
    }
}

impl EditorDiagnosticsState {
    pub fn enabled_for(&self, category: EditorDiagnosticsCategory) -> bool {
        self.enabled && self.categories.contains(&category)
    }
}

pub fn all_editor_diagnostics_categories() -> BTreeSet<EditorDiagnosticsCategory> {
    EditorDiagnosticsCategory::ALL.into_iter().collect()
}

pub fn normalize_editor_diagnostics_categories(
    categories: Vec<EditorDiagnosticsCategory>,
) -> BTreeSet<EditorDiagnosticsCategory> {
    if categories.is_empty() {
        all_editor_diagnostics_categories()
    } else {
        categories.into_iter().collect()
    }
}

pub fn editor_diagnostics_enabled(
    state: Option<&EditorDiagnosticsState>,
    category: EditorDiagnosticsCategory,
) -> bool {
    state.is_some_and(|state| state.enabled_for(category))
}

pub fn editor_diagnostics_log(
    state: Option<&EditorDiagnosticsState>,
    category: EditorDiagnosticsCategory,
    message: impl AsRef<str>,
) {
    if !editor_diagnostics_enabled(state, category) {
        return;
    }

    let line = format!(
        "[editor-diagnostics][{}] {}",
        category.label(),
        message.as_ref()
    );
    eprintln!("{line}");
    info!("{line}");
}

fn diagnostics_env_enabled() -> bool {
    std::env::var("DRUSNIEL_EDITOR_DIAGNOSTICS")
        .or_else(|_| std::env::var("DRUSNIEL_EDITOR_HEAVY_DEBUG"))
        .is_ok_and(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
}
