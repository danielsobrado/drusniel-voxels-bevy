import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const systemSource = readFileSync(new URL("./system.ts", import.meta.url), "utf8");
const wrapperSource = readFileSync(new URL("../dressing_system.ts", import.meta.url), "utf8");

describe("dressing persistent exclusion runtime integration", () => {
  it("uses the canonical bridge and refreshes without camera movement", () => {
    expect(wrapperSource).toContain("options.persistenceBridge ?? dressingPersistenceBridge");
    expect(wrapperSource).toContain("persistenceBridge,");
    expect(systemSource).toContain("const persistenceChanged = persistenceRevision !== this.lastPersistenceRevision");
    expect(systemSource).toContain("!persistenceChanged");
    expect(systemSource).toContain("dressing_persistent_exclusion_gpu_active");
    expect(systemSource).toContain("dressing_persistent_exclusion_overflow");
  });
});
