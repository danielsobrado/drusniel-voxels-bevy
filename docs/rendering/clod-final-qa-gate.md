# CLOD final QA gate

`clod_qa_gate` is the final artifact-level check. It is intentionally simple:
all expected QA streams must exist and be non-empty, and aggregate reports must
be present.

It does not replace the specialized guards. It catches incomplete QA runs where a
script silently skipped a telemetry stream.
