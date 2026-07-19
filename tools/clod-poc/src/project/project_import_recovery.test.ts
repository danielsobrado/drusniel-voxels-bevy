import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  armProjectImportRecovery,
  completeProjectImportRecovery,
  confirmProjectImportRecoveryToken,
  recoverAbandonedProjectImport,
  recoverFailedProjectImport,
} from "./project_import_recovery.js";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

beforeEach(() => {
  vi.stubGlobal("sessionStorage", new MemoryStorage());
  vi.stubGlobal("location", {
    pathname: "/",
    search: "?import=token&world=16",
    hash: "#view",
    replace: vi.fn(),
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("project import recovery", () => {
  it("restores the prior query without carrying an old import token", () => {
    armProjectImportRecovery("token", "?save=world-a&import=stale&hud=1", 1000);
    expect(confirmProjectImportRecoveryToken("token", 1001)).toBe(true);

    expect(recoverFailedProjectImport(1002)).toBe(true);
    expect(location.replace).toHaveBeenCalledWith("/?save=world-a&hud=1#view");
    expect(recoverFailedProjectImport(1003)).toBe(false);
  });

  it("recovers a reload after the one-time import token was removed from the URL", () => {
    armProjectImportRecovery("token", "?save=world-a&hud=1", 1000);
    Object.assign(location, { search: "?world=16" });

    expect(recoverAbandonedProjectImport(false, 1001)).toBe(true);
    expect(location.replace).toHaveBeenCalledWith("/?save=world-a&hud=1#view");
  });

  it("does not interrupt an active staged import route", () => {
    armProjectImportRecovery("token", "?save=world-a", 1000);
    expect(recoverAbandonedProjectImport(true, 1001)).toBe(false);
    expect(location.replace).not.toHaveBeenCalled();
    expect(confirmProjectImportRecoveryToken("token", 1002)).toBe(true);
  });

  it("disarms recovery after a successful startup", () => {
    armProjectImportRecovery("token", "?save=world-a", 1000);
    completeProjectImportRecovery();
    expect(recoverFailedProjectImport(1001)).toBe(false);
  });

  it("rejects mismatched, expired, and future recovery records", () => {
    armProjectImportRecovery("token", "?save=world-a", 1000);
    expect(confirmProjectImportRecoveryToken("other", 1001)).toBe(false);

    armProjectImportRecovery("token", "?save=world-a", 1000);
    expect(confirmProjectImportRecoveryToken("token", 31 * 60 * 1000)).toBe(false);

    armProjectImportRecovery("token", "?save=world-a", 120_001);
    expect(confirmProjectImportRecoveryToken("token", 60_000)).toBe(false);
  });

  it("fails closed when same-tab recovery storage is unavailable", () => {
    vi.stubGlobal("sessionStorage", undefined);
    expect(() => armProjectImportRecovery("token", "?save=world-a", 1000)).toThrow(/storage is unavailable/i);
  });
});
