# NAADF Risk Register

Status: active  
Last reviewed: 2026-05-14

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Packed traversal bugs | Rare ray misses, light leaks, or incorrect preview hits | Keep CPU builder/tracer as reference and require fixture parity before GPU integration |
| Dirty chunk drift | Stale GI, AO, or shadow results after edits | Treat NAADF as derived data; queue generated and dirty chunks from `VoxelWorld` dirty state |
| Integrated GPU memory pressure | Hitches, allocation failure, or fallback instability | Keep NAADF disabled by default, cap chunks/upload bytes/memory, block integrated GPUs unless explicitly allowed |
| GPU slot fragmentation | Long sessions with heavy streaming/editing may scatter active chunks across buffer slots and reduce shader locality | Track `NaadfGpuChunkTableStats.free_slot_fragmentation`; consider periodic compaction after GPU upload parity exists |
| Water mismatch | NAADF occludes water differently than the current renderer | Do not treat water as opaque in the initial NAADF GI traversal |
| Renderer scope creep | Full renderer rewrite before backend correctness is proven | Keep `Current` as default and isolate `NaadfPreview` as experimental |
| Benchmark ambiguity | False performance claims from overlapping timing rows | Use release bench summaries and report specific rows/counters only |

## Hard Stops

- Do not make NAADF mandatory for gameplay.
- Do not replace Surface Nets, blocky terrain, water, props, vegetation, sky, fog, or post-processing during the backend phase.
- Do not route production GI through NAADF until CPU and GPU hit parity are stable.
