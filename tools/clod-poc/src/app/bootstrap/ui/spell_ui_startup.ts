import type { UiStartupContext } from "../ui_startup_context.js";
import { createSpellMenu } from "../../../spells/spell_menu.js";
import { defaultSpellConfig } from "../../../spells/spell_config.js";
import "../../../spells/spell_menu.css";

export function runSpellUiStartup(_ctx: UiStartupContext): void {
  const config = defaultSpellConfig;
  const menu = createSpellMenu({ config });
  const menuEl = document.getElementById(config.menu.rootId);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== "KeyV") return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    if (menuEl) {
      menuEl.classList.toggle("visible");
    }
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("beforeunload", () => {
    window.removeEventListener("keydown", onKeyDown);
    menu.dispose();
  }, { once: true });
}
