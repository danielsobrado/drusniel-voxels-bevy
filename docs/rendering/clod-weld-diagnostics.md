# CLOD weld diagnostics

`weld_stats.rs` inspects published CLOD page meshes and produces one CSV row per page node.

The default guard treats duplicate quantized position buckets as a failure and checks that duplicate-bucket attribute deltas stay near zero. Runtime export is intentionally left for the next PR.
