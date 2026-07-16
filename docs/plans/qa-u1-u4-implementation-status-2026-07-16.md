# QA-U1 through QA-U4 implementation status

Status: code implemented on `main`; native baseline and full-battery acceptance remain QA-U5 through QA-U8 work.

## QA-U1 — schema and validation

Implemented:

- canonical visual and performance manifests under `validation/manifests`;
- strict TypeScript and Rust parsers with unknown-field rejection;
- duplicate scene and nested-ID validation;
- repository-safe baseline and mask paths;
- optional SHA-256 verification when a baseline hash is declared;
- complete legacy scene, probe, timing, counter, and informational ID map;
- canonical tag and scene selection plus reproduction command generation;
- removal of the two legacy CLOD YAML files.

## QA-U2 — deterministic runtime hooks

Implemented:

- `window.__drusnielQa` as a thin adapter over `window.__drusnielClod`;
- readiness blockers for streaming, far summaries, terrain textures, bubble failures, and proxy builds;
- freeze refusal before convergence;
- pose, world-state, settle, freeze, stats, screenshot, and checkpoint methods;
- Rust readiness and freeze-state contracts for Bevy QA.

## QA-U3 — image metrics and reports

Implemented:

- sRGB-to-linear conversion and Rec.709 luminance;
- absolute RGB percentiles and changed-pixel fraction;
- luminance, chroma, Sobel edge, weighted-mask, and region-probe metrics;
- diff, heatmap, and changed-mask images;
- JSON, Markdown, HTML, and JUnit reports.

## QA-U4 — timing and counters

Implemented:

- manifest-driven absolute timing gates;
- required and advisory enforcement;
- required and optional counter behavior;
- `NOT_APPLICABLE` informational metrics;
- failures for missing required metrics and threshold violations;
- tests covering readback-style flags, missing metrics, and overflow-style counters.

## Deliberately pending

- allowlisted specialized command orchestration;
- fresh-process determinism double runs;
- authoritative baseline update workflow;
- mandatory CLOD and Bevy baseline batteries;
- native Windows Lane B captures and accepted performance evidence.
