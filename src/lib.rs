//! Library entrypoint for the Drusniel voxel runtime.

pub mod animation;
pub mod app;
pub mod audio;
pub mod config;
pub mod content;
pub mod diagnostics;
pub mod editor;
pub mod gameplay;
pub mod particles;
pub mod physics;
pub mod props;
pub mod rendering;
pub mod shared;
pub mod terrain;
pub mod ui;
pub mod voxel;
pub mod world;

// Compatibility aliases for paths that existed before the production `src`
// organization pass. Prefer the canonical modules above for new code.
pub mod atmosphere {
    pub use crate::world::environment::atmosphere::*;
}

pub mod bench {
    pub use crate::diagnostics::bench::*;
}

pub mod building {
    pub use crate::gameplay::building::*;
}

pub mod camera {
    pub use crate::gameplay::camera::*;
}

pub mod chat {
    pub use crate::ui::chat::*;
}

pub mod constants {
    pub use crate::shared::constants::*;
}

pub mod debug_ui {
    pub use crate::diagnostics::debug_ui::*;
}

pub mod editor_bridge {
    pub use crate::editor::bridge::*;
}

pub mod editor_diagnostics {
    pub use crate::editor::diagnostics::*;
}

pub mod entity {
    pub use crate::gameplay::entity::*;
}

pub mod environment {
    pub use crate::world::environment::*;
}

pub mod input {
    pub use crate::gameplay::input::*;
}

pub mod interaction {
    pub use crate::gameplay::interaction::*;
}

pub mod inventory_ui {
    pub use crate::ui::inventory::*;
}

pub mod map {
    pub use crate::ui::map::*;
}

pub mod menu {
    pub use crate::ui::menu::*;
}

pub mod network {
    pub use crate::gameplay::network::*;
}

pub mod performance {
    pub use crate::diagnostics::timing::*;
}

pub mod player {
    pub use crate::gameplay::player::*;
}

pub mod runtime_commands {
    pub use crate::editor::runtime::*;
}

pub mod runtime_lock {
    pub use crate::app::runtime_lock::*;
}

pub mod vegetation {
    pub use crate::world::environment::vegetation::*;
}

pub mod viewmodel {
    pub use crate::gameplay::viewmodel::*;
}

pub mod weather {
    pub use crate::world::environment::weather::*;
}

pub mod world_rules {
    pub use crate::world::rules::*;
}
