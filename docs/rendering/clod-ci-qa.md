# CLOD QA CI

`.github/workflows/clod-qa.yml` runs the final CLOD QA suite on demand and on PRs
that touch CLOD, bench, shader, script, config, or rendering docs paths.

The workflow uploads `bench-runs/ci-clod-qa` and `perf-dumps` so failures can be
investigated from the generated CSV/Markdown/JSON artifacts.

This CI is intentionally dry-run by default. Real terrain mutation must be
enabled in a separate apply-mode workflow/config once the authoritative world
mutator and collider-refresh telemetry are wired.
