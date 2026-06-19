//! Constants for the stone detail layer.

/// Stone chunk size in horizontal world units. This intentionally matches the legacy prop chunk
/// grid so terrain edits invalidate the same coarse regions, while stones remain their own layer.
pub const STONE_CHUNK_SIZE: i32 = 64;

/// Bound per-frame stone chunk spawn work so camera jumps do not stall a frame.
pub const MAX_STONE_CHUNK_SPAWNS_PER_FRAME: usize = 2;

/// Stable schema marker for future stone persistence files.
pub const STONES_SCHEMA_VERSION: u32 = 1;
