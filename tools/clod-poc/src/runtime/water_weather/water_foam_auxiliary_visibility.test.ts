import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { installWaterFoamAuxiliaryVisibility } from "./water_foam_auxiliary_visibility.js";

function addNamed(scene: THREE.Scene, name: string, visible: boolean): THREE.Object3D {
  const object = new THREE.Object3D();
  object.name = name;
  object.visible = visible;
  scene.add(object);
  return object;
}

describe("water foam auxiliary visibility", () => {
  it("hides all matched overlays and restores their exact visibility", () => {
    const scene = new THREE.Scene();
    const residue = addNamed(scene, "river-bank-residue-overlay", true);
    const cascade = addNamed(scene, "river-cascade-particles", false);
    const mist = addNamed(scene, "river-mist-overlay", true);
    const controller = installWaterFoamAuxiliaryVisibility(scene);

    expect(controller.setHidden(true)).toEqual({ hidden: true, matched: 3 });
    expect([residue.visible, cascade.visible, mist.visible]).toEqual([false, false, false]);

    expect(controller.setHidden(false)).toEqual({ hidden: false, matched: 0 });
    expect([residue.visible, cascade.visible, mist.visible]).toEqual([true, false, true]);
  });

  it("ignores missing overlays and unrelated scene objects", () => {
    const scene = new THREE.Scene();
    const unrelated = addNamed(scene, "terrain", true);
    const residue = addNamed(scene, "river-bank-residue-overlay", true);
    const controller = installWaterFoamAuxiliaryVisibility(scene);

    expect(controller.setHidden(true)).toEqual({ hidden: true, matched: 1 });
    expect(residue.visible).toBe(false);
    expect(unrelated.visible).toBe(true);
  });

  it("does not replace the original snapshot on repeated hide", () => {
    const scene = new THREE.Scene();
    const residue = addNamed(scene, "river-bank-residue-overlay", true);
    const controller = installWaterFoamAuxiliaryVisibility(scene);

    controller.setHidden(true);
    residue.visible = true;
    expect(controller.setHidden(true)).toEqual({ hidden: true, matched: 1 });
    controller.setHidden(false);

    expect(residue.visible).toBe(true);
  });

  it("returns one controller per scene", () => {
    const scene = new THREE.Scene();
    expect(installWaterFoamAuxiliaryVisibility(scene)).toBe(
      installWaterFoamAuxiliaryVisibility(scene),
    );
  });
});
