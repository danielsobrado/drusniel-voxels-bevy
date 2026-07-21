import { describe, expect, it } from "vitest";
import farMaterialSource from "./tree_node_material.ts?raw";
import impostorMaterialSource from "./tree_ring_impostor_node_material.ts?raw";
import windSource from "./tree_impostor_wind.ts?raw";

describe("tree impostor wind parity contract", () => {
  it("uses the far-tree world phase and propagation constants", () => {
    for (const literal of [
      "127.1",
      "311.7",
      "43758.5453123",
      "6.2831853",
      "0.035",
      "0.37",
      "12.9898",
    ]) {
      expect(farMaterialSource).toContain(literal);
      expect(windSource).toContain(literal);
    }
    expect(windSource).toContain(".add(phase.mul(TREE_WIND_PHASE_TAU))");
    expect(windSource).toContain("dot(input.worldXZ, uniforms.direction).mul(TREE_WIND_PROPAGATION)");
  });

  it("uses the same morphology stiffness, age, scale, and yaw response as far meshes", () => {
    expect(farMaterialSource).toContain(".mul(deformation.windScale).mul(aScale)");
    expect(farMaterialSource).toContain("c.mul(localPosition.x).add(s.mul(localPosition.z))");
    expect(farMaterialSource).toContain("s.mul(localPosition.x).negate().add(c.mul(localPosition.z))");
    expect(windSource).toContain(".div(clamp(input.stiffness, 0.65, 1.35))");
    expect(windSource).toContain(".mul(mix(0.85, 1.10, clamp(input.age01, 0, 1)))");
    expect(windSource).toContain(".mul(input.instanceScale)");
    expect(windSource).toContain("yawCos.mul(localX).add(yawSin.mul(localZ))");
    expect(windSource).toContain("yawSin.mul(localX).negate().add(yawCos.mul(localZ))");
    expect(impostorMaterialSource).toContain("yaw: record.rotationNormalY.x");
  });

  it("updates time and settings instead of leaving impostors static", () => {
    expect(impostorMaterialSource).toContain("windUniforms.time.value = Number.isFinite(timeSeconds) ? timeSeconds : 0");
    expect(impostorMaterialSource).toContain("updateTreeImpostorWindUniforms(windUniforms, next)");
    expect(impostorMaterialSource).not.toContain("setTime() {}");
  });

  it("composes depth first and wind second for regular, debug, and prepass graphs", () => {
    expect(impostorMaterialSource).toContain("const applyImpostorPosition = (sourcePosition: TslNode)");
    expect(impostorMaterialSource).toContain("depthReprojection.apply(sourcePosition)");
    expect(impostorMaterialSource).toContain("return depthPosition.add(windDisplacement)");
    expect(impostorMaterialSource).toContain("material.positionNode = applyImpostorPosition(material.positionNode)");
    expect(impostorMaterialSource).toContain("positionNode: applyImpostorPosition(nodes.positionNode as TslNode)");
    expect(impostorMaterialSource).toContain("for (const material of Object.values(base.debugMaterials)");
    expect(impostorMaterialSource).toContain('counters["tree_impostor_wind_prepass_parity"] = 1');
  });

  it("does not translate the whole card at leaf-flutter frequency", () => {
    expect(windSource).not.toContain("leafFlutter");
    expect(windSource).not.toContain("time.mul(7.0)");
    expect(windSource).not.toContain("phase.mul(19.19)");
    expect(impostorMaterialSource).toContain('counters["tree_impostor_whole_card_flutter"] = 0');
  });
});
