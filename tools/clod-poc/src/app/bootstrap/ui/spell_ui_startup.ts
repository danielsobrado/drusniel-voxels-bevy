import type { UiStartupContext } from "../ui_startup_context.js";
import { createSpellMenu } from "../../../spells/spell_menu.js";
import { defaultSpellConfig } from "../../../spells/spell_config.js";
import "../../../spells/spell_menu.css";

export function runSpellUiStartup(_ctx: UiStartupContext): void {
  const config = defaultSpellConfig;
  const menu = createSpellMenu({ config });
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
  }, { once: true });
}
