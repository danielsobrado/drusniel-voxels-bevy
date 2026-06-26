import type { UiStartupContext } from "../ui_startup_context.js";
import { createSpellMenu } from "../../../spells/spell_menu.js";
import "../../../spells/spell_menu.css";

export function runSpellUiStartup(_ctx: UiStartupContext): void {
  const menu = createSpellMenu();
  const menuEl = document.getElementById("spell-menu");

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== "KeyV") return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    if (menuEl) {
      menuEl.classList.toggle("spell-menu-hidden");
    }
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("beforeunload", () => {
    window.removeEventListener("keydown", onKeyDown);
    menu.dispose();
  }, { once: true });
}
