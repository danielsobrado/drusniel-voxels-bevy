import { runAcceptanceCli } from "../src/acceptance/cli.js";

try {
  await runAcceptanceCli();
} catch (error: unknown) {
  const msg = error instanceof Error ? error.message : String(error);
  console.error("Acceptance gate error:", msg);
  process.exit(3);
}
