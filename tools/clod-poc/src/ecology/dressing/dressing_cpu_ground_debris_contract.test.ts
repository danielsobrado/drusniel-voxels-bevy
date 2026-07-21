import { describe, expect, it } from "vitest";
import cpuSourceRaw from "./dressing_system_cpu.ts?raw";

const cpuSource = cpuSourceRaw.replace(/\r\n/g, "\n");

describe("CPU ground-debris integration contract", () => {
  it("applies shared resources after initial and movement-triggered rebuilds", () => {
    expect(cpuSource).toContain("private readonly groundDebrisResources: GroundDebrisCpuResources");
    expect(cpuSource).toContain("this.groundDebrisResources = new GroundDebrisCpuResources(");
    expect(cpuSource).toContain("this.groundDebrisResources.apply(this.scene)");
    expect(cpuSource).toContain("resourcesMayChange");
    expect(cpuSource).toContain("super.update(center)");
  });

  it("does not rescan debris meshes unconditionally every frame", () => {
    expect(cpuSource).toContain("if (!resourcesMayChange) return;");
    expect(cpuSource).not.toContain("override update(center: { readonly x: number; readonly z: number }): void {\n    super.update(center);\n    this.groundDebrisResources.apply");
  });

  it("owns and disposes only its replacement resources", () => {
    expect(cpuSource).toContain("super.dispose();");
    expect(cpuSource).toContain("this.groundDebrisResources.dispose();");
  });
});
