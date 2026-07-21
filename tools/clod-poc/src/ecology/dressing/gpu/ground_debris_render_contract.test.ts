import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const renderSource = readFileSync(new URL("./render_resources.ts", import.meta.url), "utf8");
const materialSource = readFileSync(new URL("./ground_debris_material.ts", import.meta.url), "utf8");

describe("ground debris render integration", () => {
  it("reuses the existing grouped indirect renderer", () => {
    expect(renderSource).toContain("createGroundDebrisGeometry(classId, lod)");
    expect(renderSource).toContain("applyGroundDebrisMaterial(material, classId");
    expect(renderSource).toContain("geometry.setIndirect(indirect");
    expect(renderSource).not.toContain("ground-debris-ring");
  });

  it("uses stable instance data for wetness and ring-edge fade", () => {
    expect(materialSource).toContain("rotationEnvironment.z");
    expect(materialSource).toContain("rotationEnvironment.w.lessThan(visibility)");
    expect(materialSource).toContain("cameraPosition");
    expect(materialSource).toContain("material.maskNode");
  });

  it("adds no gameplay readback or per-instance CPU transform path", () => {
    expect(renderSource).not.toContain("mapAsync");
    expect(renderSource).not.toContain("getMappedRange");
    expect(materialSource).not.toContain("readback");
  });
});
