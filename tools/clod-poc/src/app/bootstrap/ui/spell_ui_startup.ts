import * as THREE from "three";
import type { UiStartupContext } from "../ui_startup_context.js";
import { createSpellMenu } from "../../../spells/spell_menu.js";
import { defaultSpellConfig, type FireSpellVfxConfig } from "../../../spells/spell_config.js";
import {
  createSpellVfxController,
  type SpellVfxMeshConfig,
} from "../../../spells/spell_vfx_controller.js";
import { createDeferredSpellController } from "../../../spells/deferred_spell_controller.js";
import { scheduleSpellPipelineWarmup } from "../../../spells/spell_pipeline_warmup.js";
import "../../../spells/spell_menu.css";

function meshConfig(vfx: FireSpellVfxConfig): SpellVfxMeshConfig {
  return {
    worldWidth: vfx.worldWidth,
    worldHeight: vfx.worldHeight,
    flameScale: vfx.flameScale,
    handForwardM: vfx.handForwardM,
    handRightM: vfx.handRightM,
    handUpM: vfx.handUpM,
    glowColor: vfx.glowColor,
    glowIntensity: vfx.glowIntensity,
    glowDistance: vfx.glowDistance,
    glowDecay: vfx.glowDecay,
    glowLocalYRatio: vfx.glowLocalYRatio,
  };
}

export function runSpellUiStartup(ctx: UiStartupContext): void {
  const config = defaultSpellConfig;
  const { scene, camera, renderer, terrainRaycast } = ctx.input;
  const targetRay = new THREE.Ray();
  const targetDirection = new THREE.Vector3();
  const targetNormal = new THREE.Vector3(0, 1, 0);

  const getTerrainTarget = () => {
    camera.getWorldDirection(targetDirection).normalize();
    targetRay.origin.copy(camera.position);
    targetRay.direction.copy(targetDirection);
    const hit = terrainRaycast.raycastEditableTerrain(targetRay);
    return hit ? { point: hit.point, normal: targetNormal } : null;
  };

  const controller = createSpellVfxController({
    scene,
    getCamera: () => camera,
    fire: meshConfig(config.fire.vfx),
    water: meshConfig(config.water.vfx),
    air: meshConfig(config.air.vfx),
    earth: config.earth.vfx,
    getEarthTarget: getTerrainTarget,
    lightning: config.lightning.vfx,
    getLightningTarget: getTerrainTarget,
    fireball: config.fireball.vfx,
    raycastFireballTerrain: (ray) => {
      const hit = terrainRaycast.raycastEditableTerrain(ray);
      return hit ? { ...hit, normal: targetNormal } : null;
    },
  });
  ctx.session.spellVfxController = controller;

  const pipelineWarmup = scheduleSpellPipelineWarmup({ renderer, scene, camera });
  const deferredController = createDeferredSpellController(controller, pipelineWarmup.ready);
  const menu = createSpellMenu({ config, controller: deferredController.controller });
  const menuEl = document.getElementById(config.menu.rootId);

  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target;
    if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    if (event.repeat) return;

    if (event.code === "KeyV") {
      menuEl?.classList.toggle("spell-menu-hidden");
      return;
    }

    if (event.code === "Digit1" || event.code === "Numpad1") {
      event.preventDefault();
      menu.castFire();
      return;
    }

    if (event.code === "Digit2" || event.code === "Numpad2") {
      event.preventDefault();
      menu.castWater();
      return;
    }

    if (event.code === "Digit3" || event.code === "Numpad3") {
      event.preventDefault();
      menu.castAir();
      return;
    }

    if (event.code === "Digit4" || event.code === "Numpad4") {
      event.preventDefault();
      menu.castEarth();
      return;
    }

    if (event.code === "Digit5" || event.code === "Numpad5") {
      event.preventDefault();
      menu.castLightning();
      return;
    }

    if (event.code === "Digit6" || event.code === "Numpad6") {
      event.preventDefault();
      menu.castFireball();
    }
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("beforeunload", () => {
    window.removeEventListener("keydown", onKeyDown);
    pipelineWarmup.dispose();
    deferredController.dispose();
    menu.dispose();
    controller.dispose();
    ctx.session.spellVfxController = null;
  }, { once: true });
}
