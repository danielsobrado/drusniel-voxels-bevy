import { emitAudio } from "../audio/index.js";
import { FireFlameRenderer } from "./fire_flame_renderer.js";
import { defaultSpellConfig, type SpellConfig } from "./spell_config.js";

export interface SpellMenu {
  castFire: () => void;
  dispose: () => void;
}

export interface SpellMenuDeps {
  config?: SpellConfig;
  root?: HTMLElement;
}

export function createSpellMenu(deps: SpellMenuDeps = {}): SpellMenu {
  const config = deps.config ?? defaultSpellConfig;
  const root = deps.root ?? ensureMenuRoot(config.menu.rootId);
  const shouldRemoveRoot = deps.root === undefined;
  const fireRenderer = new FireFlameRenderer(config.fire.vfx);
  let activeReset = 0;
  let dragOffset: { x: number; y: number } | null = null;

  root.replaceChildren();
  root.setAttribute("aria-label", "Spell menu");

  const title = document.createElement("span");
  title.className = "spell-menu-title";
  title.textContent = config.menu.title;

  const slots = document.createElement("div");
  slots.className = "spell-menu-slots";

  const fireButton = document.createElement("button");
  const onFireButtonClick = (): void => castFire();
  fireButton.type = "button";
  fireButton.textContent = `1 🔥 ${config.fire.label}`;
  fireButton.title = `${config.fire.label} spell (1)`;
  fireButton.setAttribute("aria-pressed", "false");
  fireButton.addEventListener("click", onFireButtonClick);

  root.addEventListener("pointerdown", stopUiPropagation);
  root.addEventListener("click", stopUiPropagation);
  slots.appendChild(fireButton);
  root.append(title, slots);

  title.addEventListener("pointerdown", onDragStart);

  function onDragStart(event: PointerEvent): void {
    if (!(event.target instanceof HTMLElement) || !title.contains(event.target)) return;
    event.preventDefault();
    const rect = root.getBoundingClientRect();
    dragOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    root.style.left = `${rect.left}px`;
    root.style.top = `${rect.top}px`;
    root.style.transform = "none";
    root.style.bottom = "auto";
    root.style.right = "auto";
    root.classList.add("dragging");
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", onDragEnd);
  }

  function onDragMove(event: PointerEvent): void {
    if (!dragOffset) return;
    root.style.left = `${event.clientX - dragOffset.x}px`;
    root.style.top = `${event.clientY - dragOffset.y}px`;
  }

  function onDragEnd(): void {
    dragOffset = null;
    root.classList.remove("dragging");
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragEnd);
  }

  function castFire(): void {
    window.clearTimeout(activeReset);
    fireButton.setAttribute("aria-pressed", "true");
    fireRenderer.play(config.fire.castDurationMs);
    emitAudio("spell.fire.cast", {
      volume: config.fire.audio.volume,
      durationMs: config.fire.castDurationMs,
    });
    activeReset = window.setTimeout(() => {
      fireButton.setAttribute("aria-pressed", "false");
    }, config.fire.castDurationMs);
  }

  return {
    castFire,
    dispose: () => {
      window.clearTimeout(activeReset);
      activeReset = 0;
      if (dragOffset) onDragEnd();
      title.removeEventListener("pointerdown", onDragStart);
      root.removeEventListener("pointerdown", stopUiPropagation);
      root.removeEventListener("click", stopUiPropagation);
      fireButton.removeEventListener("click", onFireButtonClick);
      fireRenderer.dispose();
      if (shouldRemoveRoot) root.remove();
      else root.replaceChildren();
    },
  };
}

function ensureMenuRoot(rootId: string): HTMLElement {
  const existing = document.getElementById(rootId);
  if (existing) return existing;

  const root = document.createElement("nav");
  root.id = rootId;
  document.body.appendChild(root);
  return root;
}

function stopUiPropagation(event: Event): void {
  event.stopPropagation();
}
