import type { Page } from "playwright";

const DEFAULT_STABLE_POLLS = 4;
const DEFAULT_POLL_MS = 100;

export interface QaConvergenceEvidence {
  elapsedMs: number;
  stablePolls: number;
  polls: number;
  lastBlockers: string[];
}

export async function waitForQaConvergence(
  page: Page,
  label: string,
  timeoutMs: number,
  stablePolls = DEFAULT_STABLE_POLLS,
): Promise<QaConvergenceEvidence> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("QA convergence timeout must be positive");
  if (!Number.isInteger(stablePolls) || stablePolls < 1) throw new Error("QA convergence stablePolls must be positive");

  const startedAt = Date.now();
  let consecutiveStable = 0;
  let polls = 0;
  let lastBlockers: string[] = ["QA convergence has not been sampled"];

  while (Date.now() - startedAt < timeoutMs) {
    const state = await page.evaluate(() => {
      const hook = window.__drusnielQa;
      return {
        missing: hook === undefined,
        error: hook?.error() ?? null,
        blockers: hook?.readinessBlockers() ?? ["window.__drusnielQa is missing"],
      };
    });
    polls++;
    if (state.error) throw new Error(`${label}: runtime error: ${state.error}`);
    if (state.missing) throw new Error(`${label}: window.__drusnielQa is missing`);
    lastBlockers = state.blockers;
    consecutiveStable = state.blockers.length === 0 ? consecutiveStable + 1 : 0;
    if (consecutiveStable >= stablePolls) {
      return {
        elapsedMs: Date.now() - startedAt,
        stablePolls: consecutiveStable,
        polls,
        lastBlockers,
      };
    }
    await page.evaluate(async () => window.__drusnielQa?.settle(1));
    await page.waitForTimeout(DEFAULT_POLL_MS);
  }

  throw new Error(`${label}: convergence timed out after ${timeoutMs}ms; blockers: ${lastBlockers.join("; ")}`);
}
