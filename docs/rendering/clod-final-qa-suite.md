# CLOD final QA suite

`run-clod-final-qa` is the full QA wrapper after PR 46–47. It runs the existing
complete QA suite, then adds:

- collider-refresh export and guard;
- apply-mode readiness guard;
- aggregate QA report if available;
- final QA gate if available.

Default mode remains dry-run. Future real apply-mode CI can pass an alternate
apply-mode config to `guard-clod-apply-mode`.
