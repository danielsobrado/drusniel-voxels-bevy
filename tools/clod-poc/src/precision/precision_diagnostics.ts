export function resolvePrecisionFrameDelta(deltaSeconds: number, enabled: boolean): number {
  return enabled ? 0 : deltaSeconds;
}

export function precisionDiagnosticUrlOverrides(): Record<string, string> {
  return {
    precisionDiag: "1",
    freeze: "1",
    clouds: "0",
    froxels: "0",
    treeWind: "0",
    grassWind: "0",
    weather: "off",
    riverCascadeParticles: "0",
    taa: "0",
    taaJitter: "0",
    exposure: "1",
  };
}
