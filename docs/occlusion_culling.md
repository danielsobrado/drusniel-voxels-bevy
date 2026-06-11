# Occlusion Culling

Terrain occlusion culling is enclosure-gated. In open terrain, chunk mesh visibility is restored to `Visibility::Inherited` and the runtime does not run the BFS culler; normal terrain LOD and frustum paths remain responsible for open-world visibility.

The enclosure heuristic biases open for correctness. The camera chunk and its six face-neighbors must be loaded, the camera chunk face-connectivity mask must not be fully transparent, and an upward sky probe must remain blocked for `sky_probe_chunks`. Missing chunks, out-of-world sky, empty chunks, or vertical face connectivity in the probe return open. The detected mode must hold for `hysteresis_secs` before the active mode switches.

Runtime traversal uses the chunk face-connectivity mask, a frustum gate dilated by `frustum_dilation_chunks`, a directional guard that prevents a path from reversing an axis it has already traveled, and a depth budget computed from `LodSettings::cull_distance + depth_margin_chunks`. If `max_visited_chunks` is exceeded, the update fails open by treating all loaded chunks as visible.

Config lives in `assets/config/occlusion.yaml`:

```yaml
occlusion:
  enabled: true
  update_interval_secs: 0.1
  depth_margin_chunks: 2
  max_visited_chunks: 8000
  frustum_dilation_chunks: 1
  enclosure:
    sky_probe_chunks: 8
    hysteresis_secs: 0.5
```

The F3 debug overlay shows enclosure mode, chunk/prop cull counts, BFS visited states, last BFS duration in microseconds, depth budget, and overflow state. `Shift+F11` force-disables enclosure culling for local comparison.
