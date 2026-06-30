# QA Status

Known state:

- Bevy host-side QA exists as `cargo run --bin qa -- --summary <summary.json>`.
- The harness consumes existing bench output only; it does not spawn benches yet.
- clod-poc has an executable Node/TS report runner:
  `rtk npm --prefix tools/clod-poc run qa -- --summary <summary.json>`.
- clod-poc browser capture and Playwright automation are still deferred.
- clod-poc region probes require region-specific captured metrics unless the
  probe covers the full viewport.
- No committed screenshot baselines have been established yet, so default runs may
  report `baseline_missing`.
- WorldSource parity test status is tracked in
  [`world-source-parity-test-ledger.md`](world-source-parity-test-ledger.md).

Do not relax a threshold to hide a real regression. Update baselines only from a
known-good run and record the reason in the commit or PR.
