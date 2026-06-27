import type { UiStartupContext } from "../ui_startup_context.js";
import { createSpellMenu } from "../../../spells/spell_menu.js";
import { defaultSpellConfig, type FireSpellVfxConfig } from "../../../spells/spell_config.js";
import {
  createSpellPoseResolver,
  createSpellVfxController,
  type SpellVfxMeshConfig,
} from "../../../spells/spell_vfx_controller.js";
import "../../../spells/spell_menu.css";

function meshConfig(vfx: FireSpellVfxConfig): SpellVfxMeshConfig {
  return { worldWidth: vfx.worldWidth, worldHeight: vfx.worldHeight, flameScale: vfx.flameScale };
}

export function runSpellUiStartup(ctx: UiStartupContext): void {
  const config = defaultSpellConfig;
  const { scene, camera } = ctx.input;

  const getPose = createSpellPoseResolver({ camera, vfx: config.fire.vfx });
  const controller = createSpellVfxController({
    scene,
    getCamera: () => camera,
    getPose,
    fire: meshConfig(config.fire.vfx),
    water: meshConfig(config.water.vfx),
  });
  ctx.session.spellVfxController = controller;

  const menu = createSpellMenu({ config, controller });
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
    }
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("beforeunload", () => {
    window.removeEventListener("keydown", onKeyDown);
    menu.dispose();
    controller.dispose();
    ctx.session.spellVfxController = null;
  }, { once: true });
}
