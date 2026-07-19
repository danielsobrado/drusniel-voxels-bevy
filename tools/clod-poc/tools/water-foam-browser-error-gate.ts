import type { CdpPage } from "./water-harness.js";

const MAX_BROWSER_ERRORS = 32;

export interface WaterFoamBrowserError {
  readonly source: "console" | "error" | "rejection" | "webgl-context";
  readonly message: string;
}

export interface WaterFoamBrowserErrorGateResult {
  readonly passed: boolean;
  readonly failures: readonly string[];
}

export async function installWaterFoamBrowserErrorCapture(page: CdpPage): Promise<void> {
  await page.send("Page.addScriptToEvaluateOnNewDocument", {
    source: browserCaptureSource(),
  });
}

export async function readWaterFoamBrowserErrors(
  page: CdpPage,
): Promise<readonly WaterFoamBrowserError[]> {
  const errors = await page.evaluate<unknown>(
    "Array.isArray(globalThis.__waterFoamBrowserErrors) ? globalThis.__waterFoamBrowserErrors : []",
  );
  if (!Array.isArray(errors)) return [];
  return errors.slice(0, MAX_BROWSER_ERRORS).flatMap((value) => normalizeBrowserError(value));
}

export function evaluateWaterFoamBrowserErrorGate(
  errors: readonly WaterFoamBrowserError[],
): WaterFoamBrowserErrorGateResult {
  const failures = errors.map((error) => `${error.source}: ${error.message}`);
  return { passed: failures.length === 0, failures };
}

function normalizeBrowserError(value: unknown): WaterFoamBrowserError[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const source = record.source;
  const message = record.message;
  if (
    source !== "console"
    && source !== "error"
    && source !== "rejection"
    && source !== "webgl-context"
  ) return [];
  if (typeof message !== "string" || message.trim().length === 0) return [];
  return [{ source, message: message.trim().slice(0, 2_000) }];
}

function browserCaptureSource(): string {
  return `(() => {
    const MAX_ERRORS = ${MAX_BROWSER_ERRORS};
    const errors = [];
    const seen = new Set();
    const text = (value) => {
      if (value instanceof Error) return value.stack || value.message || String(value);
      if (typeof value === "string") return value;
      try { return JSON.stringify(value); } catch { return String(value); }
    };
    const record = (source, values) => {
      if (errors.length >= MAX_ERRORS) return;
      const message = values.map(text).join(" ").trim().slice(0, 2000);
      if (!message || seen.has(message)) return;
      seen.add(message);
      errors.push({ source, message });
    };
    Object.defineProperty(globalThis, "__waterFoamBrowserErrors", {
      configurable: false,
      enumerable: false,
      writable: false,
      value: errors,
    });
    const originalError = console.error.bind(console);
    console.error = (...values) => {
      record("console", values);
      originalError(...values);
    };
    const originalWarn = console.warn.bind(console);
    console.warn = (...values) => {
      const message = values.map(text).join(" ");
      if (/webgl|shader|program|compile|link/i.test(message)) record("console", values);
      originalWarn(...values);
    };
    addEventListener("error", (event) => {
      record("error", [event.error || event.message || "uncaught browser error"]);
    });
    addEventListener("unhandledrejection", (event) => {
      record("rejection", [event.reason || "unhandled promise rejection"]);
    });
    addEventListener("webglcontextlost", () => {
      record("webgl-context", ["WebGL context lost"]);
    }, true);
  })();`,
  } as unknown as string;
}
