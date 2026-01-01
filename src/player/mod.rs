//! Player systems and components.
//!
//! This module provides player-related functionality including:
//! - [`controller`] - First-person player movement with physics
//! - [`input`] - Input handling for movement, jumping, and actions
//! - [`plugin`] - Bevy plugin integration
//! - [`spawn`] - Player entity spawning

mod controller;
mod input;
mod plugin;
mod spawn;

pub use controller::*;
pub use input::*;
pub use plugin::*;
pub use spawn::*;
