import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright";
import type { QaBuildIdentity } from "../src/qa/unified/build_identity.js";

export interface ExpectedQaBuildIdentity {
  commitSha: string;
  workingTreeDirty: boolean;
  packageLockSha256: string;
}

export function currentQaBuildIdentity(
  repositoryRoot: string,
  clodRoot: string,
): ExpectedQaBuildIdentity {
  const run = (args: readonly string[]): string => execFileSync("git", [...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
  }).trim();
  return {
    commitSha: run(["rev-parse", "HEAD"]),
    workingTreeDirty: run(["status", "--porcelain", "--untracked-files=normal"]) !== "",
    packageLockSha256: createHash("sha256")
      .update(readFileSync(resolve(clodRoot, "package-lock.json")))
      .digest("hex"),
  };
}

export async function assertRuntimeQaBuildIdentity(
  page: Page,
  expected: ExpectedQaBuildIdentity,
): Promise<QaBuildIdentity> {
  const actual = await page.evaluate(() => window.__drusnielQa?.environment().build ?? null);
  if (!actual) throw new Error("runtime QA build identity is missing");
  const mismatches: string[] = [];
  if (actual.commitSha !== expected.commitSha) mismatches.push(`commit ${actual.commitSha} != ${expected.commitSha}`);
  if (actual.workingTreeDirty !== expected.workingTreeDirty) {
    mismatches.push(`dirty ${actual.workingTreeDirty} != ${expected.workingTreeDirty}`);
  }
  if (actual.packageLockSha256 !== expected.packageLockSha256) {
    mismatches.push(`package-lock ${actual.packageLockSha256} != ${expected.packageLockSha256}`);
  }
  if (mismatches.length > 0) {
    throw new Error(`runtime server does not match the checked-out source: ${mismatches.join("; ")}`);
  }
  return actual;
}
