//! Procedural and UI audio feedback system for Drusniel.
//!
//! The audio event vocabulary and lightweight feedback approach were inspired by
//! the MIT-licensed world-of-claudecraft audio reference under docs/reference/world-of-claudecraft-audio.

pub mod config;
pub mod events;
pub mod playback;
pub mod plugin;
pub mod throttle;

#[cfg(test)]
mod tests;
