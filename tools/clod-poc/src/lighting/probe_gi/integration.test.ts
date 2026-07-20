import { describe, expect, it } from "vitest";
import configText from "../../../config/probe_gi.yaml?raw";
import { parseProbeGiConfig } from "./config.js";
import { applyProbeGiQueryOverrides } from "./integration.js";

describe("probe GI integration overrides", () => {
  const config = parseProbeGiConfig(configText);

  it("keeps the unfinished system default-off and allows explicit WebGPU testing", () => {
    expect(applyProbeGiQueryOverrides(config, new URLSearchParams()).enabled).toBe(false);
    expect(applyProbeGiQueryOverrides(config, new URLSearchParams("probeGi=1")).enabled).toBe(true);
    expect(applyProbeGiQueryOverrides({ ...config, enabled: true }, new URLSearchParams("probeGi=0")).enabled).toBe(false);
  });

  it("validates debug modes instead of casting arbitrary strings", () => {
    expect(applyProbeGiQueryOverrides(config, new URLSearchParams("probeGiDebug=validity")).debug).toMatchObject({ enabled: true, mode: "validity" });
    expect(() => applyProbeGiQueryOverrides(config, new URLSearchParams("probeGiDebug=invalid"))).toThrow(/invalid probeGiDebug/);
  });
});
