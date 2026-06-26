import type { UiStartupContext } from "../ui_startup_context.js";
import { createSpellMenu } from "../../../spells/spell_menu.js";
import "../../../spells/spell_menu.css";

export function runSpellUiStartup(_ctx: UiStartupContext): void {
  const menu = createSpellMenu();

  window.addEventListener("beforeunload", () => {
    menu.dispose();
  }, { once: true });
}
