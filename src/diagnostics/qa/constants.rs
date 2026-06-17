//! Centralized QA constants and durable conventions.
//!
//! Keep defaults and shared numeric conventions here so the config defaults,
//! probes, and report all agree on one source of truth.

/// QA report schema version. Bump when the `qa-report.json` shape changes; the
/// clod-poc runner pins the same number so a regression reads identically in
/// both repos.
pub const QA_REPORT_SCHEMA_VERSION: u32 = 1;

/// Rec.709 luminance weights. Applied to sRGB bytes; the weighted sum is then
/// normalized to `0..1`. Shared by every luminance probe so observed values are
/// directly comparable across probe types.
pub const LUMA_R: f64 = 0.2126;
pub const LUMA_G: f64 = 0.7152;
pub const LUMA_B: f64 = 0.0722;

/// Default per-pixel max-channel delta (normalized `0..1`) above which a pixel
/// counts as changed for the changed-pixel ratio.
pub const DEFAULT_CHANGED_PIXEL_THRESHOLD: f32 = 0.08;
/// Default maximum fraction of changed pixels before an image diff fails.
pub const DEFAULT_MAX_CHANGED_RATIO: f64 = 0.02;
/// Default maximum RMSE (byte-scale, `0..255`) before an image diff fails.
pub const DEFAULT_MAX_RMSE: f64 = 6.0;
/// Default maximum mean absolute error (byte-scale, `0..255`) before failing.
pub const DEFAULT_MAX_MEAN_ABS_ERROR: f64 = 3.0;
